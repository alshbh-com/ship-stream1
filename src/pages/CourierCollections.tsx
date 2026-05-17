import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Lock, Search, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activityLogger';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoUrl from '@/assets/logo.jpg';

const RETURN_STATUS_NAMES = ['مرتجع', 'رفض ودفع شحن', 'رفض ولم يدفع شحن', 'تهرب', 'ملغي', 'لم يرد', 'لا يرد'];

export default function CourierCollections() {
  const { user, isOwner } = useAuth();
  const [couriers, setCouriers] = useState<any[]>([]);
  const [selectedCourier, setSelectedCourier] = useState('');
  const [statuses, setStatuses] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [commissionPerOrder, setCommissionPerOrder] = useState('');
  const [commissionStatuses, setCommissionStatuses] = useState<string[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [bonuses, setBonuses] = useState<any[]>([]);
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [bonusType, setBonusType] = useState<'special' | 'office_commission'>('special');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier');
      if (roles && roles.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', roles.map(r => r.user_id));
        setCouriers(profiles || []);
      }
      const { data: sts } = await supabase.from('order_statuses').select('*').order('sort_order');
      setStatuses(sts || []);
      const { data: officeData } = await supabase.from('offices').select('id, name').order('name');
      setOffices(officeData || []);
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedCourier) loadCourierData();
    else {
      setOrders([]);
      setBonuses([]);
      setSelectedOrders(new Set());
    }
  }, [selectedCourier]);

  const loadCourierData = async () => {
    const { data: orderData } = await supabase
      .from('orders')
      .select('*, order_statuses(name, color)')
      .eq('courier_id', selectedCourier)
      .eq('is_courier_closed', false)
      .order('created_at', { ascending: false });
    setOrders(orderData || []);
    setSelectedOrders(new Set());
    const notes: Record<string, string> = {};
    (orderData || []).forEach((o: any) => { notes[o.id] = o.notes || ''; });
    setOrderNotes(notes);

    const { data: bonusData } = await supabase
      .from('courier_bonuses')
      .select('*')
      .eq('courier_id', selectedCourier)
      .order('created_at', { ascending: false });
    setBonuses(bonusData || []);
  };

  const deliveredStatus = statuses.find(s => s.name === 'تم التسليم');
  const rejectWithShipStatus = statuses.find(s => s.name === 'رفض ودفع شحن');
  const halfShipStatus = statuses.find(s => s.name === 'استلم ودفع نص الشحن');
  const partialDeliveryStatus = statuses.find(s => s.name === 'تسليم جزئي');

  const getCollectedAmount = (order: any) => {
    if (order.status_id === deliveredStatus?.id) return Number(order.price) + Number(order.delivery_price);
    if (order.status_id === partialDeliveryStatus?.id) return Number(order.partial_amount || 0);
    if (order.status_id === rejectWithShipStatus?.id || order.status_id === halfShipStatus?.id) return Number(order.shipping_paid || 0);
    return 0;
  };

  const totalCollection = orders.reduce((sum, o) => sum + getCollectedAmount(o), 0);

  const rate = parseFloat(commissionPerOrder) || 0;
  const eligibleOrders = orders.filter(o => commissionStatuses.includes(o.status_id));
  const commissionTotal = eligibleOrders.length * rate;

  // مرتجع = عداد فقط — يشمل: مرتجع، رفض ودفع شحن، رفض ولم يدفع شحن، تهرب، ملغي، لم يرد، لا يرد
  const returnsCount = orders.filter(o => RETURN_STATUS_NAMES.includes(o.order_statuses?.name)).length;
  const regularBonuses = bonuses.filter(b => !b.reason?.startsWith('__office_commission__'));
  const totalRegularBonuses = regularBonuses.reduce((sum, b) => sum + Number(b.amount), 0);

  // المرتجع لا يؤثر على الحساب — مجرد إحصائية
  const netDue = totalCollection - commissionTotal - totalRegularBonuses;

  const toggleStatus = (statusId: string) => {
    setCommissionStatuses(prev => prev.includes(statusId) ? prev.filter(s => s !== statusId) : [...prev, statusId]);
  };

  const toggleStatusFilter = (statusId: string) => {
    setStatusFilter(prev => prev.includes(statusId) ? prev.filter(s => s !== statusId) : [...prev, statusId]);
  };

  const getOfficeName = (officeId: string) => offices.find(o => o.id === officeId)?.name || '-';

  // Filter orders by status and search
  const filteredOrders = orders.filter(o => {
    const matchesStatus = statusFilter.length === 0 || statusFilter.includes(o.status_id);
    if (!matchesStatus) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (o.barcode || '').toLowerCase().includes(q) ||
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_phone || '').toLowerCase().includes(q) ||
      (o.customer_code || '').toLowerCase().includes(q)
    );
  });

  const toggleSelectOrder = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleSelectAllOrders = () => {
    if (filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
      return;
    }
    setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
  };

  const closeSelectedOrders = async () => {
    if (selectedOrders.size === 0) { toast.error('اختر أوردرات للتقفيل'); return; }
    if (!confirm(`هل تريد تقفيل ${selectedOrders.size} أوردر؟`)) return;

    const ids = Array.from(selectedOrders);
    const { error } = await supabase.from('orders').update({ is_courier_closed: true }).in('id', ids);
    if (error) {
      toast.error(error.message);
      return;
    }

    logActivity('تقفيل أوردرات من تحصيلات المندوب', { courier_id: selectedCourier, count: ids.length });
    toast.success(`تم تقفيل ${ids.length} أوردر`);
    setSelectedOrders(new Set());
    loadCourierData();
  };

  const addBonus = async () => {
    if (!bonusAmount || !selectedCourier) return;
    const { error } = await supabase.from('courier_bonuses').insert({
      courier_id: selectedCourier,
      amount: parseFloat(bonusAmount),
      reason: bonusType === 'office_commission' ? `__office_commission__${bonusReason ? ':' + bonusReason : ''}` : (bonusReason || 'عمولة للمندوب'),
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    logActivity('إضافة عمولة لمندوب', { courier_id: selectedCourier, type: bonusType, amount: parseFloat(bonusAmount) });
    toast.success(bonusType === 'office_commission' ? 'تم إضافة المرتجع' : 'تم إضافة العمولة');
    setBonusDialogOpen(false);
    setBonusAmount('');
    setBonusReason('');
    loadCourierData();
  };

  const deleteBonus = async (id: string) => {
    if (!confirm('حذف هذه العمولة؟')) return;
    await supabase.from('courier_bonuses').delete().eq('id', id);
    logActivity('حذف عمولة مندوب', { bonus_id: id, courier_id: selectedCourier });
    toast.success('تم الحذف');
    loadCourierData();
  };

  const updateOrderNotes = async (orderId: string, notes: string) => {
    setOrderNotes(prev => ({ ...prev, [orderId]: notes }));
  };

  const saveOrderNotes = async (orderId: string) => {
    const notes = orderNotes[orderId] || '';
    const { error } = await supabase.from('orders').update({ notes }).eq('id', orderId);
    if (error) { toast.error('فشل حفظ الملاحظة'); return; }
    toast.success('تم حفظ الملاحظة');
  };

  const courierName = couriers.find(c => c.id === selectedCourier)?.full_name || '';

  const exportExcel = async () => {
    if (!filteredOrders.length) { toast.error('لا توجد أوردرات للتصدير'); return; }
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Star Logistics Systems';
      const ws = wb.addWorksheet('حساب المندوب', { views: [{ rightToLeft: true }] });

      const logoResp = await fetch(logoUrl);
      const logoBuf = await logoResp.arrayBuffer();
      const imgId = wb.addImage({ buffer: logoBuf, extension: 'jpeg' });
      ws.addImage(imgId, { tl: { col: 0.2, row: 0.2 }, ext: { width: 90, height: 90 } });
      ws.getRow(1).height = 70;

      ws.mergeCells('B1:I1');
      const t = ws.getCell('B1');
      t.value = 'Star Logistics Systems';
      t.font = { name: 'Cairo', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };

      ws.mergeCells('B2:I2');
      const s = ws.getCell('B2');
      s.value = `حساب المندوب: ${courierName}  -  ${new Date().toLocaleDateString('ar-EG')}`;
      s.font = { name: 'Cairo', size: 13, bold: true };
      s.alignment = { horizontal: 'center', vertical: 'middle' };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
      ws.getRow(2).height = 25;

      const headers = ['#', 'الباركود', 'التاريخ', 'العميل', 'الهاتف', 'الراسل', 'المبلغ', 'الحالة', 'التحصيل'];
      const hr = ws.addRow(headers);
      hr.eachCell((c) => {
        c.font = { name: 'Cairo', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      hr.height = 22;

      filteredOrders.forEach((o, i) => {
        const collected = getCollectedAmount(o);
        const r = ws.addRow([
          i + 1, o.barcode || '-',
          o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-',
          o.customer_name || '-', o.customer_phone || '-',
          getOfficeName(o.office_id),
          Number(o.price) + Number(o.delivery_price),
          o.order_statuses?.name || '-',
          collected,
        ]);
        r.eachCell((c, col) => {
          c.font = { name: 'Cairo', size: 10 };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
          if (col === 7 || col === 9) c.numFmt = '#,##0" ج.م"';
        });
        if (i % 2 === 0) r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }; });
      });

      ws.addRow([]);
      const summary: [string, number | string][] = [
        ['عدد الأوردرات', filteredOrders.length],
        ['إجمالي التحصيل', totalCollection],
        ['عدد المرتجعات', `${returnsCount} أوردر`],
        ['العمولة (تخصم)', commissionTotal],
        ['مواصلات/بنود إضافية', totalRegularBonuses],
        ['صافي المستحق للمندوب', netDue],
      ];
      summary.forEach(([label, val], idx) => {
        const r = ws.addRow([]);
        ws.mergeCells(`A${r.number}:F${r.number}`);
        const lc = ws.getCell(`G${r.number}`);
        const vc = ws.getCell(`H${r.number}`);
        ws.mergeCells(`H${r.number}:I${r.number}`);
        lc.value = label;
        vc.value = val;
        lc.font = { name: 'Cairo', bold: true, size: 11 };
        vc.font = { name: 'Cairo', bold: true, size: 11, color: { argb: idx === 5 ? 'FFEA580C' : 'FF1F2937' } };
        lc.alignment = { horizontal: 'right', vertical: 'middle' };
        vc.alignment = { horizontal: 'center', vertical: 'middle' };
        if (typeof val === 'number') vc.numFmt = '#,##0" ج.م"';
        [lc, vc].forEach(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
          c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.height = 22;
      });

      ws.columns = [
        { width: 6 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 16 },
        { width: 18 }, { width: 14 }, { width: 18 }, { width: 14 },
      ];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `حساب-${courierName}-${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      toast.success('تم التصدير بنجاح');
    } catch (err: any) {
      toast.error('خطأ في التصدير: ' + err.message);
    }
  };

  const exportPDF = () => {
    if (!filteredOrders.length) { toast.error('لا توجد أوردرات للتصدير'); return; }
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = filteredOrders.map((o, i) => `<tr>
      <td>${i + 1}</td>
      <td>${o.barcode || '-'}</td>
      <td>${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td>${o.customer_name || '-'}</td>
      <td>${o.customer_phone || '-'}</td>
      <td>${getOfficeName(o.office_id)}</td>
      <td>${Number(o.price) + Number(o.delivery_price)}</td>
      <td>${o.order_statuses?.name || '-'}</td>
      <td>${getCollectedAmount(o) || '-'}</td>
    </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
      <title>حساب ${courierName}</title>
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: 'Cairo', Tahoma, Arial; font-size: 11px; padding: 10px; }
        .header { display: flex; align-items: center; gap: 15px; border-bottom: 3px solid #ea580c; padding-bottom: 10px; margin-bottom: 12px; }
        .header img { height: 70px; }
        .header h1 { margin: 0; color: #ea580c; font-size: 22px; }
        .header p { margin: 4px 0 0; color: #666; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1f2937; color: #fff; padding: 6px; border: 1px solid #1f2937; }
        td { padding: 5px; border: 1px solid #ddd; text-align: center; }
        tr:nth-child(even) td { background: #fafafa; }
        .summary { margin-top: 15px; }
        .summary table { width: 60%; margin-right: 0; }
        .summary th { background: #fef3e7; color: #1f2937; text-align: right; }
        .summary td { text-align: center; font-weight: bold; }
        .total-row td { background: #ea580c; color: #fff; font-size: 13px; }
      </style></head><body>
      <div class="header"><img src="${logoUrl}" /><div><h1>Star Logistics Systems</h1><p>حساب المندوب: ${courierName} - ${new Date().toLocaleDateString('ar-EG')}</p></div></div>
      <table>
        <thead><tr><th>#</th><th>الباركود</th><th>التاريخ</th><th>العميل</th><th>الهاتف</th><th>الراسل</th><th>المبلغ</th><th>الحالة</th><th>التحصيل</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary"><table>
        <tr><th>عدد الأوردرات</th><td>${filteredOrders.length}</td></tr>
        <tr><th>إجمالي التحصيل</th><td>${totalCollection} ج.م</td></tr>
        <tr><th>عدد المرتجعات</th><td>${returnsCount} أوردر</td></tr>
        <tr><th>العمولة (تخصم)</th><td>${commissionTotal} ج.م</td></tr>
        <tr><th>مواصلات/بنود إضافية</th><td>${totalRegularBonuses} ج.م</td></tr>
        <tr class="total-row"><th style="background:#ea580c;color:#fff">صافي المستحق للمندوب</th><td>${netDue} ج.م</td></tr>
      </table></div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script>
      </body></html>`);
    w.document.close();
  };
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">تحصيلات المندوبين</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">المندوب</Label>
          <Select value={selectedCourier} onValueChange={setSelectedCourier}>
            <SelectTrigger className="w-48 bg-secondary border-border"><SelectValue placeholder="اختر مندوب" /></SelectTrigger>
            <SelectContent>{couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {selectedCourier && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card border-border"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">إجمالي التحصيل</p><p className="text-lg font-bold text-emerald-500">{totalCollection} ج.م</p></CardContent></Card>
            <Card className="bg-card border-border"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">مرتجع</p><p className="text-lg font-bold text-amber-500">{returnsCount} <span className="text-xs">أوردر</span></p></CardContent></Card>
            <Card className="bg-card border-border"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">المواصلات</p><p className="text-lg font-bold text-destructive">{commissionTotal} ج.م</p></CardContent></Card>
            <Card className="bg-card border-border"><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">صافي المستحق</p><p className="text-lg font-bold text-primary">{netDue} ج.م</p></CardContent></Card>
          </div>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">حاسبة المواصلات</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Dialog open={bonusDialogOpen} onOpenChange={v => { setBonusDialogOpen(v); if (!v) setBonusType('special'); }}>
                  <Button size="sm" variant="outline" onClick={() => { setBonusType('special'); setBonusDialogOpen(true); }}><Plus className="h-4 w-4 ml-1" />مواصلات</Button>
                  <DialogContent className="bg-card border-border">
                    <DialogHeader><DialogTitle>إضافة مواصلات</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                      <div><Label>المبلغ</Label><Input type="number" value={bonusAmount} onChange={e => setBonusAmount(e.target.value)} className="bg-secondary border-border" /></div>
                      <div><Label>السبب</Label><Input value={bonusReason} onChange={e => setBonusReason(e.target.value)} className="bg-secondary border-border" placeholder="مشوار / مواصلات..." /></div>
                      <Button onClick={addBonus} className="w-full">حفظ</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                {selectedOrders.size > 0 && (
                  <Button size="sm" variant="destructive" onClick={closeSelectedOrders}><Lock className="h-4 w-4 ml-1" />تقفيل ({selectedOrders.size})</Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {statuses.map(s => (
                  <Badge key={s.id}
                    style={{ backgroundColor: commissionStatuses.includes(s.id) ? s.color : undefined }}
                    variant={commissionStatuses.includes(s.id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleStatus(s.id)}>
                    {s.name}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">مبلغ المواصلات لكل أوردر (ج.م)</Label>
                  <Input type="number" value={commissionPerOrder} onChange={e => setCommissionPerOrder(e.target.value)}
                    className="w-40 bg-secondary border-border" placeholder="30"
                    onFocus={e => { if (e.target.value === '0') setCommissionPerOrder(''); }} />
                </div>
                <p className="text-sm">= {commissionTotal} ج.م ({eligibleOrders.length} أوردر)</p>
              </div>
            </CardContent>
          </Card>

          {bonuses.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">المواصلات والمرتجعات</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="border-border">
                    <TableHead className="text-right">النوع</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead className="text-right">السبب</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {bonuses.map(b => (
                      <TableRow key={b.id} className="border-border">
                        <TableCell className="text-sm">{b.reason?.startsWith('__office_commission__') ? 'مرتجع' : 'مواصلات'}</TableCell>
                        <TableCell className="font-bold">{b.amount} ج.م</TableCell>
                        <TableCell>{b.reason?.startsWith('__office_commission__') ? (b.reason.split(':')[1] || '-') : (b.reason || '-')}</TableCell>
                        <TableCell>{new Date(b.created_at).toLocaleDateString('ar-EG')}</TableCell>
                        <TableCell>
                          {isOwner && (
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteBonus(b.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Search and Status Filters */}
          <Card className="bg-card border-border">
            <CardContent className="p-3 space-y-3">
              <div className="relative">
                <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="بحث بالباركود أو اسم العميل أو رقم الهاتف..."
                  className="bg-secondary border-border pr-8"
                />
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">فلتر حسب الحالة:</p>
                <div className="flex flex-wrap gap-2">
                  {statuses.map(s => (
                    <label key={s.id} className="flex items-center gap-1 cursor-pointer text-sm">
                      <Checkbox checked={statusFilter.includes(s.id)} onCheckedChange={() => toggleStatusFilter(s.id)} />
                      <Badge style={{ backgroundColor: s.color }} className="text-xs">{s.name}</Badge>
                    </label>
                  ))}
                  <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => {
                    setStatusFilter(statuses.map(s => s.id));
                  }}>الكل</Button>
                  {statusFilter.length > 0 && (
                    <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setStatusFilter([])}>
                      إلغاء الفلتر
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader><CardTitle className="text-base">أوردرات المندوب ({filteredOrders.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="text-right w-10"><Checkbox checked={filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length} onCheckedChange={toggleSelectAllOrders} /></TableHead>
                      <TableHead className="text-right">الكود</TableHead>
                      <TableHead className="text-right">الباركود</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">الهاتف</TableHead>
                      <TableHead className="text-right">الراسل</TableHead>
                      <TableHead className="text-right">العنوان</TableHead>
                      <TableHead className="text-right">المبلغ</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">التحصيل</TableHead>
                      <TableHead className="text-right">تعليق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.length === 0 ? (
                      <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-4">لا توجد أوردرات</TableCell></TableRow>
                    ) : filteredOrders.map(o => {
                      const collected = getCollectedAmount(o);
                      return (
                        <TableRow key={o.id} className="border-border">
                          <TableCell><Checkbox checked={selectedOrders.has(o.id)} onCheckedChange={() => toggleSelectOrder(o.id)} /></TableCell>
                          <TableCell className="font-mono text-xs">{o.customer_code || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">{o.barcode || '-'}</TableCell>
                          <TableCell className="text-xs">{o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-'}</TableCell>
                          <TableCell className="text-sm">{o.customer_name || '-'}</TableCell>
                          <TableCell className="text-xs">{o.customer_phone || '-'}</TableCell>
                          <TableCell className="text-xs">{getOfficeName(o.office_id)}</TableCell>
                          <TableCell className="text-xs">{o.address || '-'}</TableCell>
                          <TableCell className="font-bold">{Number(o.price) + Number(o.delivery_price)} ج.م</TableCell>
                          <TableCell>
                            <Badge style={{ backgroundColor: o.order_statuses?.color }} className="text-xs">
                              {o.order_statuses?.name || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-bold text-primary">{collected > 0 ? `${collected} ج.م` : '-'}</TableCell>
                          <TableCell>
                            <Input
                              value={orderNotes[o.id] || ''}
                              onChange={(e) => updateOrderNotes(o.id, e.target.value)}
                              onBlur={() => saveOrderNotes(o.id)}
                              className="bg-secondary border-border h-7 w-32 text-xs"
                              placeholder="تعليق..."
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
