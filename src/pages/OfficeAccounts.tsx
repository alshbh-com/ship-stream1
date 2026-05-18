import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, Printer, FileSpreadsheet, Search } from 'lucide-react';
import { toast } from 'sonner';
import { logActivity } from '@/lib/activityLogger';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import logoUrl from '@/assets/logo.jpg';
import { format } from 'date-fns';


export default function OfficeAccounts() {
  const { isOwner } = useAuth();
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState('all');
  const [statuses, setStatuses] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [period, setPeriod] = useState('all');
  const [payments, setPayments] = useState<any[]>([]);
  const [officeOrders, setOfficeOrders] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [courierCommissionRate, setCourierCommissionRate] = useState('');
  const [officeCommissionRate, setOfficeCommissionRate] = useState('');

  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceOffice, setAdvanceOffice] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceNotes, setAdvanceNotes] = useState('');
  const [advanceType, setAdvanceType] = useState('advance');

  const [editItem, setEditItem] = useState<any>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    supabase.from('offices').select('id, name').order('name').then(({ data }) => setOffices(data || []));
    supabase.from('order_statuses').select('*').order('sort_order').then(({ data }) => setStatuses(data || []));
    // Load couriers
    const loadCouriers = async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier');
      if (roles && roles.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', roles.map(r => r.user_id));
        setCouriers(profiles || []);
      }
    };
    loadCouriers();
  }, []);

  useEffect(() => { loadAccounts(); }, [selectedOffice, period, offices, statuses]);

  useEffect(() => {
    if (selectedOffice !== 'all') loadOfficeOrders();
    else setOfficeOrders([]);
  }, [selectedOffice]);

  const loadOfficeOrders = async () => {
    const { data } = await supabase
      .from('orders')
      .select('id, barcode, status_id, partial_amount, shipping_paid, price, delivery_price, is_settled, customer_code, customer_name, customer_phone, courier_id, office_id, created_at')
      .eq('office_id', selectedOffice)
      .eq('is_closed', false)
      .order('created_at', { ascending: false });
    setOfficeOrders(data || []);
  };

  const toggleSettled = async (orderId: string, settled: boolean) => {
    await supabase.from('orders').update({ is_settled: settled } as any).eq('id', orderId);
    setOfficeOrders(prev => prev.map(o => o.id === orderId ? { ...o, is_settled: settled } : o));
    toast.success(settled ? 'تم تحديد كخالص' : 'تم إلغاء التحديد');
  };

  const getDateFilter = () => {
    const now = new Date();
    if (period === 'daily') return now.toISOString().split('T')[0];
    if (period === 'monthly') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    if (period === 'yearly') return new Date(now.getFullYear(), 0, 1).toISOString();
    return null;
  };

  const loadPayments = async () => {
    const { data } = await supabase.from('office_payments').select('*').order('created_at', { ascending: false });
    setPayments(data || []);
  };

  const loadAccounts = async () => {
    if (offices.length === 0 || statuses.length === 0) return;
    await loadPayments();

    const officeList = selectedOffice === 'all' ? offices : offices.filter(o => o.id === selectedOffice);
    const dateFilter = getDateFilter();

    const deliveredStatus = statuses.find(s => s.name === 'تم التسليم');
    const postponedStatus = statuses.find(s => s.name === 'مؤجل');
    const partialStatus = statuses.find(s => s.name === 'تسليم جزئي');
    const returnStatusIds = statuses
      .filter(s => ['رفض ولم يدفع شحن', 'رفض ودفع شحن', 'تهرب', 'ملغي', 'لم يرد', 'لايرد'].includes(s.name))
      .map(s => s.id);

    const { data: allPayments } = await supabase.from('office_payments').select('*');

    const result = await Promise.all(officeList.map(async (office) => {
      let query = supabase
        .from('orders')
        .select('price, delivery_price, status_id, partial_amount')
        .eq('office_id', office.id)
        .eq('is_closed', false);

      if (dateFilter) query = query.gte('created_at', dateFilter);
      const { data: orders } = await query;
      if (!orders) return null;

      const officePayments = (allPayments || []).filter(p => p.office_id === office.id);
      const advancePaid = officePayments.filter(p => p.type === 'advance').reduce((sum, p) => sum + Number(p.amount), 0);
      const commission = officePayments.filter(p => p.type === 'commission').reduce((sum, p) => sum + Number(p.amount), 0);
      const shippingDiscount = officePayments.filter(p => p.type === 'shipping_discount').reduce((sum, p) => sum + Number(p.amount), 0);
      const partialManual = officePayments.filter(p => p.type === 'partial_delivery').reduce((sum, p) => sum + Number(p.amount), 0);

      const deliveredOrders = orders.filter(o => o.status_id === deliveredStatus?.id);
      const deliveredTotal = deliveredOrders.reduce((sum, o) => sum + Number(o.price), 0);
      const deliveredShipping = deliveredOrders.reduce((sum, o) => sum + Number(o.delivery_price || 0), 0);
      const returnedTotal = orders.filter(o => returnStatusIds.includes(o.status_id)).reduce((sum, o) => sum + Number(o.price), 0);
      const postponedOrders = orders.filter(o => o.status_id === postponedStatus?.id);
      const postponedTotal = postponedOrders.reduce((sum, o) => sum + Number(o.price), 0);
      const partialOrders = orders.filter(o => o.status_id === partialStatus?.id);
      const partialCourierCollected = partialOrders.reduce((sum, o) => sum + Number(o.partial_amount || 0), 0);
      const partialShipping = partialOrders.reduce((sum, o) => sum + Number(o.delivery_price || 0), 0);
      // صافي الجزئي المستحق للمكتب = (المحصَّل - الشحن) لكل أوردر، بحد أدنى صفر
      const partialNetForOffice = partialOrders.reduce((sum, o) => {
        const collected = Number(o.partial_amount || 0);
        const ship = Number(o.delivery_price || 0);
        return sum + Math.max(0, collected - ship);
      }, 0);

      // المستحق للمكتب:
      // - تم التسليم: نضيف سعر المنتج كاملاً (price) لأن المكتب استلم price+shipping من العميل والشحن من حقي
      // - تسليم جزئي: نضيف (المحصَّل - الشحن) لأن المكتب استلم المحصَّل والشحن من حقي
      // - مرتجع/تسليم جزئي يدوي/خصم شحن/عمولة/دفعات تخصم
      const settlement = (deliveredTotal + partialNetForOffice + partialManual) - (advancePaid + returnedTotal + shippingDiscount + commission);
      const settlementWithPostponed = settlement + postponedTotal;

      return {
        id: office.id,
        name: office.name,
        orderCount: orders.length,
        deliveredTotal,
        returnedTotal,
        postponedTotal,
        partialManual,
        partialCourierCollected,
        shippingDiscount,
        settlement,
        settlementWithPostponed,
        advancePaid,
        commission,
      };
    }));

    setAccounts(result.filter(Boolean));
  };

  const saveAdvance = async () => {
    if (!advanceOffice || !advanceAmount) { toast.error('اختر مكتب وأدخل المبلغ'); return; }

    const defaultNote =
      advanceType === 'advance' ? 'دفعة' :
      advanceType === 'commission' ? 'عمولة' :
      advanceType === 'partial_delivery' ? 'تسليم جزئي (يدوي)' :
      'خصم شحن';

    const { error } = await supabase.from('office_payments').insert({
      office_id: advanceOffice,
      amount: parseFloat(advanceAmount),
      type: advanceType,
      notes: advanceNotes || defaultNote,
    });

    if (error) { toast.error('حدث خطأ: ' + error.message); return; }

    logActivity('إضافة عملية مالية لمكتب', {
      office_id: advanceOffice,
      type: advanceType,
      amount: parseFloat(advanceAmount),
    });

    toast.success('تم الحفظ بنجاح');
    setAdvanceOpen(false);
    setAdvanceAmount('');
    setAdvanceNotes('');
    setAdvanceOffice('');
    setAdvanceType('advance');
    loadAccounts();
  };

  const updatePayment = async () => {
    if (!editItem) return;

    const { error } = await supabase
      .from('office_payments')
      .update({ amount: parseFloat(editAmount), notes: editNotes })
      .eq('id', editItem.id);

    if (error) { toast.error(error.message); return; }

    logActivity('تعديل معاملة مكتب', { payment_id: editItem.id });
    toast.success('تم التحديث');
    setEditItem(null);
    loadAccounts();
  };

  const deletePayment = async (id: string) => {
    if (!confirm('حذف هذا السجل؟')) return;
    await supabase.from('office_payments').delete().eq('id', id);
    logActivity('حذف معاملة مكتب', { payment_id: id });
    toast.success('تم الحذف');
    loadAccounts();
  };

  const officePaymentsList = payments.filter(p => selectedOffice === 'all' || p.office_id === selectedOffice);
  const selectedAccount = selectedOffice !== 'all' ? accounts.find(a => a.id === selectedOffice) : null;

  const filterableStatuses = statuses;

  const toggleStatusFilter = (statusId: string) => {
    setSelectedStatuses(prev =>
      prev.includes(statusId) ? prev.filter(id => id !== statusId) : [...prev, statusId]
    );
  };

  // Filter orders by status AND search
  const filteredOrders = officeOrders.filter(o => {
    const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(o.status_id);
    if (!matchesStatus) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_phone || '').toLowerCase().includes(q) ||
      (o.barcode || '').toLowerCase().includes(q) ||
      (o.customer_code || '').toLowerCase().includes(q)
    );
  });

  const courierRate = parseFloat(courierCommissionRate) || 0;
  const officeRate = parseFloat(officeCommissionRate) || 0;

  const getCourierName = (courierId: string | null) => {
    if (!courierId) return '-';
    return couriers.find(c => c.id === courierId)?.full_name || '-';
  };

  const getOfficeName = (officeId: string | null) => {
    if (!officeId) return '-';
    return offices.find(o => o.id === officeId)?.name || '-';
  };

  // حساب "الإجمالي المستحق للمكتب" لكل أوردر بحسب حالته
  // - تم التسليم/مؤجل: المكتب استحقاقه = price (الشحن من حقي)
  // - تسليم جزئي: المكتب استحقاقه = max(0, partial_amount - delivery_price)
  // - مرتجع/ملغي/تهرب/...: 0
  // - رفض ودفع شحن: 0 للمكتب (الشحن للنظام)
  // - باقي الحالات: price (افتراضي - معلّق/قيد التنفيذ)
  const getOrderOfficeDue = (o: any) => {
    const status = statuses.find(s => s.id === o.status_id);
    const name = status?.name || '';
    const price = Number(o.price || 0);
    const ship = Number(o.delivery_price || 0);
    const partial = Number(o.partial_amount || 0);
    if (name === 'تسليم جزئي') return Math.max(0, partial - ship);
    if (['مرتجع', 'رفض ولم يدفع شحن', 'رفض ودفع شحن', 'تهرب', 'ملغي', 'لم يرد', 'لايرد'].includes(name)) return 0;
    return price; // تم التسليم / مؤجل / غيرها
  };

  const getStatusSummary = () => {
    const statusesToShow = selectedStatuses.length > 0
      ? filterableStatuses.filter(s => selectedStatuses.includes(s.id))
      : filterableStatuses;

    return statusesToShow.map(status => {
      const ords = officeOrders.filter(o => o.status_id === status.id);
      const isPartial = status.name === 'تسليم جزئي';
      // الإجمالي المعروض = المستحق للمكتب (للجزئي = المحصَّل، لغيره = price)
      const total = ords.reduce((sum, o) => sum + (isPartial ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0)), 0);
      const shipping = ords.reduce((sum, o) => sum + Number(o.delivery_price || 0), 0);
      // الصافي = المستحق للمكتب الفعلي (price للتسليم، partial-shipping للجزئي)
      const net = ords.reduce((sum, o) => sum + getOrderOfficeDue(o), 0);
      return {
        statusName: status.name,
        statusColor: status.color,
        count: ords.length,
        total,
        shipping,
        net,
      };
    }).filter(s => s.count > 0);
  };

  const statusSummary = selectedOffice !== 'all' ? getStatusSummary() : [];
  const summaryTotalAll = statusSummary.reduce((sum, s) => sum + s.total, 0);
  const summaryShippingAll = statusSummary.reduce((sum, s) => sum + s.shipping, 0);
  const summaryNetAll = statusSummary.reduce((sum, s) => sum + s.net, 0);

  const officeName = offices.find(o => o.id === selectedOffice)?.name || '';

  // التحصيل = الفلوس اللي المندوب استلمها من العميل فعلاً
  const getOrderCollected = (o: any) => {
    const status = statuses.find(s => s.id === o.status_id);
    const name = status?.name || '';
    const price = Number(o.price || 0);
    const ship = Number(o.delivery_price || 0);
    const partial = Number(o.partial_amount || 0);
    const shipPaid = Number(o.shipping_paid || 0);
    if (name === 'رفض ودفع شحن' || name === 'استلم ودفع نص الشحن') return shipPaid;
    if (partial > 0) return partial;
    if (name === 'تم التسليم') return price + ship;
    return 0;
  };

  // الحسبة الحية المربوطة بـ "عمولة الشركة لكل أوردر" (نفس معادلة الإكسيل):
  // المستحق الصافي للمكتب = إجمالي التحصيل − إجمالي عمولة الشركة
  const liveTotalCollected = officeOrders.reduce((s, o) => s + getOrderCollected(o), 0);
  const liveTotalCommission = officeOrders.reduce((s, o) => s + (getOrderCollected(o) > 0 ? officeRate : 0), 0);
  const liveNetDue = liveTotalCollected - liveTotalCommission;
  const livePostponedTotal = selectedAccount?.postponedTotal || 0;
  const liveAdvancePaid = selectedAccount?.advancePaid || 0;
  const liveSettlement = liveNetDue - liveAdvancePaid;
  const liveSettlementWithPostponed = liveSettlement + livePostponedTotal;

  const exportToExcel = async () => {
    if (filteredOrders.length === 0) { toast.error('لا توجد بيانات للتصدير'); return; }
    try {
      const statusName = (sid: string) => statuses.find(s => s.id === sid)?.name || '-';

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Star Logistics Systems';
      wb.created = new Date();
      const ws = wb.addWorksheet('حسابات المكتب', { views: [{ rightToLeft: true }] });

      // اللوجو
      const logoResp = await fetch(logoUrl);
      const logoBuf = await logoResp.arrayBuffer();
      const imgId = wb.addImage({ buffer: logoBuf, extension: 'jpeg' });
      ws.addImage(imgId, { tl: { col: 0.2, row: 0.2 }, ext: { width: 90, height: 90 } });
      ws.getRow(1).height = 70;

      // الترويسة
      ws.mergeCells('B1:L1');
      const titleCell = ws.getCell('B1');
      titleCell.value = 'Star Logistics Systems';
      titleCell.font = { name: 'Cairo', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };

      ws.mergeCells('B2:L2');
      const subCell = ws.getCell('B2');
      subCell.value = `حساب المكتب: ${officeName}  -  ${format(new Date(), 'yyyy-MM-dd')}`;
      subCell.font = { name: 'Cairo', size: 13, bold: true };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
      ws.getRow(2).height = 25;

      // رأس الجدول
      const headers = ['#', 'الباركود', 'الكود', 'العميل', 'الهاتف', 'السعر', 'الشحن', 'التحصيل', 'عمولة الشركة', 'المستحق', 'الحالة', 'المندوب'];
      const headerRow = ws.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Cairo', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      headerRow.height = 22;

      // البيانات
      filteredOrders.forEach((o, i) => {
        const st = statuses.find(s => s.id === o.status_id);
        const isPartial = st?.name === 'تسليم جزئي';
        const displayPrice = isPartial ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0);
        const collected = getOrderCollected(o);
        // عمولة الشركة = اللي حضرتك بتحددها (لكل أوردر فيه تحصيل فقط)
        const commission = collected > 0 ? officeRate : 0;
        // المستحق = التحصيل - عمولة الشركة
        const net = Math.max(0, collected - commission);
        const r = ws.addRow([
          i + 1,
          o.barcode || '-',
          o.customer_code || '-',
          o.customer_name || '-',
          o.customer_phone || '-',
          displayPrice,
          Number(o.delivery_price || 0),
          collected,
          commission,
          net,
          statusName(o.status_id),
          getCourierName(o.courier_id),
        ]);
        r.eachCell((cell, col) => {
          cell.font = { name: 'Cairo', size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
          if ([6, 7, 8, 9, 10].includes(col)) cell.numFmt = '#,##0" ج.م"';
        });
        if (i % 2 === 0) r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }; });
      });

      // الإجماليات
      const totalPrice = filteredOrders.reduce((s, o) => {
        const st = statuses.find(x => x.id === o.status_id);
        return s + (st?.name === 'تسليم جزئي' ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0));
      }, 0);
      const totalShipping = filteredOrders.reduce((s, o) => s + Number(o.delivery_price || 0), 0);
      const totalCollected = filteredOrders.reduce((s, o) => s + getOrderCollected(o), 0);
      const totalCommission = filteredOrders.reduce((s, o) => s + (getOrderCollected(o) > 0 ? officeRate : 0), 0);
      const totalNet = filteredOrders.reduce((s, o) => {
        const c = getOrderCollected(o);
        const com = c > 0 ? officeRate : 0;
        return s + Math.max(0, c - com);
      }, 0);
      const returnStatusNames = ['مرتجع', 'رفض ولم يدفع شحن', 'رفض ودفع شحن', 'تهرب', 'ملغي', 'لم يرد', 'لايرد'];
      const returnsCount = filteredOrders.filter(o => returnStatusNames.includes(statuses.find(s => s.id === o.status_id)?.name || '')).length;
      const partialCount = filteredOrders.filter(o => statuses.find(s => s.id === o.status_id)?.name === 'تسليم جزئي').length;

      ws.addRow([]);
      const summary: [string, any, boolean?][] = [
        ['عدد الأوردرات', filteredOrders.length],
        ['عدد المرتجعات (شامل الرفض)', returnsCount],
        ['عدد التسليم الجزئي', partialCount],
        ['إجمالي السعر', totalPrice, true],
        ['إجمالي الشحن', totalShipping, true],
        ['إجمالي التحصيل (مع المندوب)', totalCollected, true],
        ['إجمالي عمولة الشركة', totalCommission, true],
        ['المستحق الصافي للمكتب (التحصيل - العمولة)', totalNet, true],
      ];
      summary.forEach(([label, val, money]) => {
        const r = ws.addRow(['', '', '', '', '', '', '', '', label, val, '', '']);
        ws.mergeCells(`A${r.number}:H${r.number}`);
        const labelCell = ws.getCell(`I${r.number}`);
        const valCell = ws.getCell(`J${r.number}`);
        labelCell.value = label;
        valCell.value = val;
        labelCell.font = { name: 'Cairo', bold: true, size: 11 };
        valCell.font = { name: 'Cairo', bold: true, size: 11 };
        labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
        valCell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (money) valCell.numFmt = '#,##0" ج.م"';
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
        valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3E7' } };
        labelCell.border = valCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        r.height = 22;
      });

      ws.columns = [
        { width: 6 }, { width: 15 }, { width: 12 }, { width: 20 }, { width: 14 },
        { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
        { width: 16 }, { width: 16 },
      ];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `حسابات-${officeName}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      link.click();
      toast.success('تم التصدير بنجاح');
    } catch (err: any) {
      toast.error('خطأ في التصدير: ' + err.message);
    }
  };

  const printSheet = () => {
    if (filteredOrders.length === 0) { toast.error('لا توجد بيانات للطباعة'); return; }
    const statusName = (sid: string) => statuses.find(s => s.id === sid)?.name || '-';
    const w = window.open('', '_blank');
    if (!w) return;

    const orderRows = filteredOrders.map((o, i) => {
      const st = statuses.find(s => s.id === o.status_id);
      const isPartial = st?.name === 'تسليم جزئي';
      const displayTotal = isPartial ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0);
      return `<tr>
        <td>${i + 1}</td>
        <td>${o.barcode || '-'}</td>
        <td>${o.customer_name || '-'}</td>
        <td>${o.customer_phone || '-'}</td>
        <td>${displayTotal}${isPartial ? ` <small>(من ${Number(o.price || 0)})</small>` : ''}</td>
        <td>${Number(o.delivery_price || 0)}</td>
        <td>${courierRate}</td>
        <td style="text-align:center">${statusName(o.status_id) === 'مرتجع' ? '✓' : '-'}</td>
        <td>${getOrderOfficeDue(o)}</td>
        <td>${statusName(o.status_id)}</td>
        <td>${getCourierName(o.courier_id)}</td>
      </tr>`;
    }).join('');

    const totalPrice = filteredOrders.reduce((s, o) => {
      const st = statuses.find(x => x.id === o.status_id);
      return s + (st?.name === 'تسليم جزئي' ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0));
    }, 0);
    const totalShipping = filteredOrders.reduce((s, o) => s + Number(o.delivery_price || 0), 0);
    const totalNet = filteredOrders.reduce((s, o) => s + getOrderOfficeDue(o), 0);

    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
    <title>حسابات ${officeName}</title>
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11px; margin: 0; padding: 10px; }
      .header { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 5px; }
      .sub-header { text-align: center; font-size: 12px; color: #666; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
      th, td { border: 1px solid #333; padding: 4px 6px; text-align: right; font-size: 10px; }
      th { background: #f0f0f0; font-weight: bold; }
      .total-row { background: #e8f4e8; font-weight: bold; }
    </style></head><body>
    <div class="header">Star Logistics - حسابات ${officeName}</div>
    <div class="sub-header">${format(new Date(), 'dd/MM/yyyy')}</div>
    
    <table>
      <thead><tr><th>#</th><th>الباركود</th><th>العميل</th><th>الهاتف</th><th>الإجمالي</th><th>الشحن</th><th>مواصلات المندوب</th><th>مرتجع</th><th>الصافي</th><th>الحالة</th><th>المندوب</th></tr></thead>
      <tbody>
        ${orderRows}
        <tr class="total-row">
          <td colspan="4">الإجمالي (${filteredOrders.length} أوردر)</td>
          <td>${totalPrice}</td>
          <td>${totalShipping}</td>
          <td>${courierRate * filteredOrders.length}</td>
          <td style="text-align:center">${filteredOrders.filter(o => statusName(o.status_id) === 'مرتجع').length} أوردر</td>
          <td>${totalNet}</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const paymentTypeLabel = (type: string) => {
    if (type === 'advance') return 'دفعة';
    if (type === 'commission') return 'عمولة';
    if (type === 'shipping_discount') return 'خصم شحن';
    if (type === 'partial_delivery') return 'تسليم جزئي (يدوي)';
    return type;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">حسابات المكاتب</h1>
        <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 ml-1" />إضافة دفعة / عمولة / خصم شحن / تسليم جزئي</Button></DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>إضافة عملية مالية</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>المكتب</Label>
                <Select value={advanceOffice} onValueChange={setAdvanceOffice}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="اختر مكتب" /></SelectTrigger>
                  <SelectContent>{offices.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>النوع</Label>
                <Select value={advanceType} onValueChange={setAdvanceType}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="advance">دفعة</SelectItem>
                    <SelectItem value="commission">عمولة</SelectItem>
                    <SelectItem value="shipping_discount">خصم الشحن</SelectItem>
                    <SelectItem value="partial_delivery">تسليم جزئي (يدوي)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>المبلغ</Label><Input type="number" value={advanceAmount} onChange={e => setAdvanceAmount(e.target.value)} className="bg-secondary border-border" /></div>
              <div><Label>ملاحظات</Label><Input value={advanceNotes} onChange={e => setAdvanceNotes(e.target.value)} className="bg-secondary border-border" /></div>
              <Button onClick={saveAdvance} className="w-full">حفظ</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={selectedOffice} onValueChange={setSelectedOffice}>
          <SelectTrigger className="w-44 bg-secondary border-border"><SelectValue placeholder="اختر مكتب" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المكاتب</SelectItem>
            {offices.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Tabs value={period} onValueChange={setPeriod} className="w-auto">
          <TabsList className="bg-secondary">
            <TabsTrigger value="all">الكل</TabsTrigger>
            <TabsTrigger value="daily">يومي</TabsTrigger>
            <TabsTrigger value="monthly">شهري</TabsTrigger>
            <TabsTrigger value="yearly">سنوي</TabsTrigger>
          </TabsList>
        </Tabs>
        {selectedOffice !== 'all' && (
          <>
            <Button size="sm" variant="outline" onClick={exportToExcel}>
              <FileSpreadsheet className="h-4 w-4 ml-1" />Excel
            </Button>
            <Button size="sm" variant="outline" onClick={printSheet}>
              <Printer className="h-4 w-4 ml-1" />طباعة
            </Button>
          </>
        )}
      </div>

      {/* Status filter checkboxes */}
      {selectedOffice !== 'all' && filterableStatuses.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-sm font-semibold mb-2">فلتر حسب الحالة:</p>
            <div className="flex flex-wrap gap-3">
              {filterableStatuses.map(s => (
                <label key={s.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <Checkbox
                    checked={selectedStatuses.includes(s.id)}
                    onCheckedChange={() => toggleStatusFilter(s.id)}
                  />
                  <Badge style={{ backgroundColor: s.color }} className="text-xs">{s.name}</Badge>
                </label>
              ))}
              {selectedStatuses.length > 0 && (
                <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setSelectedStatuses([])}>
                  إلغاء الفلتر
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + commission rates */}
      {selectedOffice !== 'all' && (
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">بحث بالاسم أو رقم الهاتف أو الباركود</Label>
                <div className="relative">
                  <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="بحث..."
                    className="bg-secondary border-border pr-8"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">مواصلات المندوب (لكل أوردر)</Label>
                <Input
                  type="number"
                  value={courierCommissionRate}
                  onChange={e => setCourierCommissionRate(e.target.value)}
                  className="w-32 bg-secondary border-border"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">عمولة الشركة (لكل أوردر)</Label>
                <Input
                  type="number"
                  value={officeCommissionRate}
                  onChange={e => setOfficeCommissionRate(e.target.value)}
                  className="w-32 bg-secondary border-border"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">عدد المرتجعات</Label>
                <div className="w-32 h-10 px-3 flex items-center bg-secondary border border-border rounded-md text-sm font-bold text-blue-500">
                  {filteredOrders.filter(o => ['مرتجع','رفض ولم يدفع شحن','رفض ودفع شحن','تهرب','ملغي','لم يرد','لايرد'].includes(statuses.find(s => s.id === o.status_id)?.name || '')).length} أوردر
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">عدد التسليم الجزئي</Label>
                <div className="w-32 h-10 px-3 flex items-center bg-secondary border border-border rounded-md text-sm font-bold text-amber-600">
                  {filteredOrders.filter(o => statuses.find(s => s.id === o.status_id)?.name === 'تسليم جزئي').length} أوردر
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedAccount && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">المستحق</p>
              <p className="text-2xl font-bold text-primary">{liveSettlement} ج.م</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                التحصيل {liveTotalCollected} − العمولة {liveTotalCommission}
                {liveAdvancePaid ? ` − المدفوع ${liveAdvancePaid}` : ''}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">المستحق بالمؤجل</p>
              <p className="text-2xl font-bold text-primary">{liveSettlementWithPostponed} ج.م</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status summary table */}
      {selectedOffice !== 'all' && statusSummary.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">ملخص حسب الحالة</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">العدد</TableHead>
                    <TableHead className="text-right">الإجمالي</TableHead>
                    <TableHead className="text-right">العمولة (شحن)</TableHead>
                    <TableHead className="text-right">الصافي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusSummary.map((s, i) => (
                    <TableRow key={i} className="border-border">
                      <TableCell>
                        <Badge style={{ backgroundColor: s.statusColor }} className="text-xs">{s.statusName}</Badge>
                      </TableCell>
                      <TableCell className="text-sm font-bold">{s.count}</TableCell>
                      <TableCell className="text-sm font-bold">{s.total} ج.م</TableCell>
                      <TableCell className="text-sm font-bold">{s.shipping} ج.م</TableCell>
                      <TableCell className="text-sm font-bold text-primary">{s.net} ج.م</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-border bg-muted/50">
                    <TableCell className="font-bold">المجموع</TableCell>
                    <TableCell className="font-bold">{statusSummary.reduce((s, x) => s + x.count, 0)}</TableCell>
                    <TableCell className="font-bold">{summaryTotalAll} ج.م</TableCell>
                    <TableCell className="font-bold">{summaryShippingAll} ج.م</TableCell>
                    <TableCell className="font-bold text-primary">{summaryNetAll} ج.م</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-right">المكتب</TableHead>
                  <TableHead className="text-right">عدد</TableHead>
                  <TableHead className="text-right">تسليم</TableHead>
                  <TableHead className="text-right">مرتجع</TableHead>
                  <TableHead className="text-right">مؤجل</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">تسليم جزئي (يدوي)</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">تحصيل جزئي مندوب</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">خصم شحن</TableHead>
                  <TableHead className="text-right">المدفوع</TableHead>
                  <TableHead className="text-right">العمولة</TableHead>
                  <TableHead className="text-right">المستحق</TableHead>
                  <TableHead className="text-right">بالمؤجل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>
                ) : accounts.map(a => (
                  <TableRow key={a.id} className="border-border">
                    <TableCell className="font-medium text-sm">{a.name}</TableCell>
                    <TableCell className="text-sm">{a.orderCount}</TableCell>
                    <TableCell className="font-bold text-sm">{a.deliveredTotal} ج.م</TableCell>
                    <TableCell className="font-bold text-sm">{a.returnedTotal} ج.م</TableCell>
                    <TableCell className="font-bold text-sm">{a.postponedTotal} ج.م</TableCell>
                    <TableCell className="font-bold text-sm hidden sm:table-cell">{a.partialManual} ج.م</TableCell>
                    <TableCell className="font-bold text-sm hidden sm:table-cell">{a.partialCourierCollected} ج.م</TableCell>
                    <TableCell className="text-sm hidden sm:table-cell">{a.shippingDiscount} ج.م</TableCell>
                    <TableCell className="font-bold text-sm">{a.advancePaid} ج.م</TableCell>
                    <TableCell className="text-sm font-bold">{a.commission} ج.م</TableCell>
                    <TableCell className="font-bold text-sm">{selectedOffice !== 'all' && a.id === selectedOffice ? liveSettlement : a.settlement} ج.م</TableCell>
                    <TableCell className="font-bold text-sm">{selectedOffice !== 'all' && a.id === selectedOffice ? liveSettlementWithPostponed : a.settlementWithPostponed} ج.م</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedOffice !== 'all' && filteredOrders.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">أوردرات المكتب ({filteredOrders.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                     <TableHead className="text-right">الباركود</TableHead>
                     <TableHead className="text-right">العميل</TableHead>
                     <TableHead className="text-right">الهاتف</TableHead>
                     <TableHead className="text-right">المكتب</TableHead>
                     <TableHead className="text-right">الإجمالي</TableHead>
                     <TableHead className="text-right">الشحن</TableHead>
                     <TableHead className="text-right">مواصلات المندوب</TableHead>
                     <TableHead className="text-right">مرتجع المكتب</TableHead>
                     <TableHead className="text-right">الصافي</TableHead>
                     <TableHead className="text-right">الحالة</TableHead>
                     <TableHead className="text-right">المندوب</TableHead>
                     <TableHead className="text-right hidden sm:table-cell">التاريخ</TableHead>
                     <TableHead className="text-right">خالص</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((o) => {
                    const status = statuses.find(s => s.id === o.status_id);
                    const isPartial = status?.name === 'تسليم جزئي';
                    const price = Number(o.price || 0);
                    const shipping = Number(o.delivery_price || 0);
                    const partial = Number(o.partial_amount || 0);
                    // الإجمالي المعروض = للجزئي: المحصَّل من المندوب، لغيره: سعر الأوردر
                    const displayTotal = isPartial ? Math.max(0, partial - shipping) : price;
                    // الصافي = المستحق الفعلي للمكتب
                    const net = getOrderOfficeDue(o);
                    const createdDate = o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-';
                    return (
                      <TableRow key={o.id} className="border-border">
                        <TableCell className="font-mono text-xs">
                          <div className="space-y-1">
                            <div>{o.barcode || '-'}</div>
                            <div className="text-[11px] text-muted-foreground sm:hidden">{createdDate}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{o.customer_name || '-'}</TableCell>
                        <TableCell className="text-sm">{o.customer_phone || '-'}</TableCell>
                        <TableCell className="text-sm">{getOfficeName(o.office_id)}</TableCell>
                        <TableCell className="text-sm font-bold">
                          {displayTotal} ج.م
                          {isPartial && <span className="text-[10px] text-muted-foreground block">(محصَّل {partial} منهم {shipping} شحن، من أصل {price})</span>}
                        </TableCell>
                        <TableCell className="text-sm">{shipping} ج.م</TableCell>
                        <TableCell className="text-sm text-amber-500 font-bold">{courierRate} ج.م</TableCell>
                        <TableCell className="text-sm text-blue-500 font-bold text-center">{status?.name === 'مرتجع' ? '✓' : '-'}</TableCell>
                        <TableCell className="text-sm font-bold text-primary">{net} ج.م</TableCell>
                        <TableCell>
                          {status ? <Badge style={{ backgroundColor: status.color }} className="text-xs">{status.name}</Badge> : '-'}
                        </TableCell>
                        <TableCell className="text-sm">{getCourierName(o.courier_id)}</TableCell>
                        <TableCell className="text-xs hidden sm:table-cell">{createdDate}</TableCell>
                        <TableCell>
                          <Button size="sm" variant={o.is_settled ? 'default' : 'outline'} className={`text-xs h-6 px-2 ${o.is_settled ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`} onClick={() => toggleSettled(o.id, !o.is_settled)}>
                            {o.is_settled ? '✓ خالص' : 'خالص'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-border bg-muted/50">
                    <TableCell colSpan={4} className="font-bold">الإجمالي ({filteredOrders.length})</TableCell>
                    <TableCell className="font-bold">{filteredOrders.reduce((s, o) => {
                      const st = statuses.find(x => x.id === o.status_id);
                      return s + (st?.name === 'تسليم جزئي' ? Math.max(0, Number(o.partial_amount || 0) - Number(o.delivery_price || 0)) : Number(o.price || 0));
                    }, 0)} ج.م</TableCell>
                    <TableCell className="font-bold">{filteredOrders.reduce((s, o) => s + Number(o.delivery_price || 0), 0)} ج.م</TableCell>
                    <TableCell className="font-bold text-amber-500">{courierRate * filteredOrders.length} ج.م</TableCell>
                    <TableCell className="font-bold text-blue-500 text-center">{filteredOrders.filter(o => statuses.find(s => s.id === o.status_id)?.name === 'مرتجع').length}</TableCell>
                    <TableCell className="font-bold text-primary">{filteredOrders.reduce((s, o) => s + getOrderOfficeDue(o), 0)} ج.م</TableCell>
                    <TableCell colSpan={4} />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {officePaymentsList.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-3">سجل الدفعات والعمولات</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-right">المكتب</TableHead>
                    <TableHead className="text-right">النوع</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead className="text-right">ملاحظات</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {officePaymentsList.map(p => (
                    <TableRow key={p.id} className="border-border">
                      <TableCell className="text-sm">{offices.find(o => o.id === p.office_id)?.name || '-'}</TableCell>
                      <TableCell className="text-sm">{paymentTypeLabel(p.type)}</TableCell>
                      <TableCell className="font-bold text-sm">{p.amount} ج.م</TableCell>
                      <TableCell className="text-sm">{p.notes || '-'}</TableCell>
                      <TableCell className="text-sm">{new Date(p.created_at).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => { setEditItem(p); setEditAmount(String(p.amount)); setEditNotes(p.notes || ''); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {isOwner && (
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deletePayment(p.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editItem} onOpenChange={v => { if (!v) setEditItem(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>تعديل السجل</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>المبلغ</Label><Input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="bg-secondary border-border" /></div>
            <div><Label>ملاحظات</Label><Input value={editNotes} onChange={e => setEditNotes(e.target.value)} className="bg-secondary border-border" /></div>
            <Button onClick={updatePayment} className="w-full">حفظ</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="bg-card border-border p-4">
        <h3 className="font-semibold mb-2">معادلة صافي الحساب:</h3>
        <p className="text-sm text-muted-foreground">المستحق = (التسليمات + تسليم جزئي يدوي) - (المدفوع + المرتجع + خصم الشحن + العمولة)</p>
        <p className="text-sm text-muted-foreground">المستحق بالمؤجل = المستحق + المؤجل</p>
        <p className="text-sm text-muted-foreground mt-1">الصافي = الإجمالي - العمولة (الشحن)</p>
      </Card>
    </div>
  );
}
