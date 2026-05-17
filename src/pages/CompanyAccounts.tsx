import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import logoUrl from '@/assets/logo.jpg';

export default function CompanyAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: sts } = await supabase.from('order_statuses').select('*');
      setStatuses(sts || []);

      const { data: companies } = await supabase.from('companies').select('*');
      if (!companies) return;

      const deliveredId = (sts || []).find((s: any) => s.name === 'تم التسليم')?.id;
      const partialId = (sts || []).find((s: any) => s.name === 'تسليم جزئي')?.id;

      const result = await Promise.all(companies.map(async (company) => {
        const { data: orders } = await supabase
          .from('orders')
          .select('price, delivery_price, partial_amount, status_id')
          .eq('company_id', company.id);

        const ordersList = orders || [];
        const orderCount = ordersList.length;

        // إجمالي الشغل = سعر المنتجات (المستحق نظرياً للشركة)
        const totalWork = ordersList.reduce((sum, o) => sum + Number(o.price), 0);

        // التحصيل = اللي اتجمع فعلاً من المناديب (السعر + الشحن للموصلة، أو الجزئي)
        const totalCollected = ordersList.reduce((sum, o) => {
          if (o.status_id === deliveredId) return sum + Number(o.price) + Number(o.delivery_price);
          if (o.status_id === partialId) return sum + Number(o.partial_amount || 0);
          return sum;
        }, 0);

        // العمولة = إجمالي الشحن (دخل شركة الشحن)
        const totalCommission = ordersList.reduce((sum, o) => {
          if (o.status_id === deliveredId || o.status_id === partialId) return sum + Number(o.delivery_price);
          return sum;
        }, 0);

        // المستحق للشركة = التحصيل - العمولة
        const netDue = totalCollected - totalCommission;

        const { data: payments } = await supabase
          .from('company_payments')
          .select('amount')
          .eq('company_id', company.id);

        const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

        return {
          ...company,
          orderCount,
          totalWork,
          totalCollected,
          totalCommission,
          netDue,
          totalPaid,
          remaining: netDue - totalPaid,
        };
      }));

      setAccounts(result);
    };
    load();
  }, []);

  const exportExcel = async (company: any) => {
    try {
      const { data: orders } = await supabase
        .from('orders')
        .select('barcode, customer_name, customer_phone, price, delivery_price, partial_amount, status_id, created_at, order_statuses(name)')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false });

      const list = orders || [];
      const deliveredId = statuses.find((s: any) => s.name === 'تم التسليم')?.id;
      const partialId = statuses.find((s: any) => s.name === 'تسليم جزئي')?.id;

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Star Logistics Systems';
      wb.created = new Date();
      const ws = wb.addWorksheet('حساب الشركة', { views: [{ rightToLeft: true }] });

      // اللوجو - في خانة فاضية مخصصة له (عرضي)
      const logoResp = await fetch(logoUrl);
      const logoBuf = await logoResp.arrayBuffer();
      const imgId = wb.addImage({ buffer: logoBuf, extension: 'jpeg' });
      // ندمج خلية مخصصة للوجو في أول الصف ونحط اللوجو جواها بشكل عرضي
      ws.mergeCells('A1:A2');
      ws.addImage(imgId, {
        tl: { col: 0.1, row: 0.1 },
        ext: { width: 140, height: 55 },
        editAs: 'oneCell',
      });
      ws.getRow(1).height = 32;
      ws.getRow(2).height = 32;

      // الترويسة - بعد خانة اللوجو
      ws.mergeCells('B1:H1');
      const titleCell = ws.getCell('B1');
      titleCell.value = 'Star Logistics Systems';
      titleCell.font = { name: 'Cairo', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };

      ws.mergeCells('B2:H2');
      const subCell = ws.getCell('B2');
      subCell.value = `حساب الشركة: ${company.name}  -  ${new Date().toLocaleDateString('ar-EG')}`;
      subCell.font = { name: 'Cairo', size: 13, bold: true };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
      ws.getRow(2).height = 25;

      // رأس الجدول
      const headerRow = ws.addRow(['#', 'الباركود', 'التاريخ', 'العميل', 'الهاتف', 'السعر', 'الشحن', 'الحالة']);
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Cairo', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      headerRow.height = 22;

      // بيانات الأوردرات
      list.forEach((o: any, i: number) => {
        const r = ws.addRow([
          i + 1,
          o.barcode || '-',
          o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-',
          o.customer_name || '-',
          o.customer_phone || '-',
          Number(o.price || 0),
          Number(o.delivery_price || 0),
          o.order_statuses?.name || '-',
        ]);
        r.eachCell((cell, col) => {
          cell.font = { name: 'Cairo', size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
          if (col === 6 || col === 7) cell.numFmt = '#,##0" ج.م"';
        });
        if (i % 2 === 0) {
          r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }; });
        }
      });

      // الملخص
      ws.addRow([]);
      const summary: [string, number][] = [
        ['إجمالي عدد الأوردرات', list.length],
        ['التحصيل (المحصّل من العملاء)', company.totalCollected],
        ['العمولة (شحن شركة الشحن)', company.totalCommission],
        ['المستحق للشركة (التحصيل - العمولة)', company.netDue],
        ['المدفوع للشركة', company.totalPaid],
        ['المتبقي', company.remaining],
      ];
      summary.forEach(([label, val], idx) => {
        const r = ws.addRow(['', '', '', '', '', label, val, '']);
        ws.mergeCells(`A${r.number}:E${r.number}`);
        const labelCell = ws.getCell(`F${r.number}`);
        const valCell = ws.getCell(`G${r.number}`);
        labelCell.value = label;
        valCell.value = val;
        labelCell.font = { name: 'Cairo', bold: true, size: 11 };
        valCell.font = { name: 'Cairo', bold: true, size: 11, color: { argb: idx === 5 && company.remaining > 0 ? 'FFDC2626' : 'FF1F2937' } };
        labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
        valCell.alignment = { horizontal: 'center', vertical: 'middle' };
        valCell.numFmt = idx === 0 ? '0' : '#,##0" ج.م"';
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
        valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
        labelCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        valCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        r.height = 22;
      });

      // عرض الأعمدة
      ws.columns = [
        { width: 6 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 16 },
        { width: 14 }, { width: 14 }, { width: 18 },
      ];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `حساب-${company.name}-${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      toast.success('تم التصدير بنجاح');
    } catch (err: any) {
      toast.error('خطأ في التصدير: ' + err.message);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">حسابات الشركات</h1>
      <Card className="bg-card border-border">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="text-right">الشركة</TableHead>
                <TableHead className="text-right">عدد الأوردرات</TableHead>
                <TableHead className="text-right">التحصيل</TableHead>
                <TableHead className="text-right">العمولة</TableHead>
                <TableHead className="text-right">المستحق</TableHead>
                <TableHead className="text-right">المدفوع</TableHead>
                <TableHead className="text-right">المتبقي</TableHead>
                <TableHead className="text-right">تصدير</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className="border-border">
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.orderCount}</TableCell>
                  <TableCell className="text-emerald-600 font-bold">{a.totalCollected} ج.م</TableCell>
                  <TableCell className="text-amber-600">{a.totalCommission} ج.م</TableCell>
                  <TableCell className="font-bold">{a.netDue} ج.م</TableCell>
                  <TableCell>{a.totalPaid} ج.م</TableCell>
                  <TableCell className={a.remaining > 0 ? 'text-destructive font-bold' : 'text-emerald-600 font-bold'}>
                    {a.remaining} ج.م
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => exportExcel(a)}>
                      <FileSpreadsheet className="h-4 w-4 ml-1" />Excel
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
