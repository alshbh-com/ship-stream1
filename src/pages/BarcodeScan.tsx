import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScanLine, Play, CheckCircle2, Trash2, Printer, FileSpreadsheet, FileText, Lock, UserPlus, UserMinus, X } from 'lucide-react';
import { toast } from 'sonner';
import { logActivity } from '@/lib/activityLogger';
import ExcelJS from 'exceljs';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
const saveAs = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function barcodeDataUrl(value: string): string {
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value || '0', { format: 'CODE128', displayValue: true, height: 50, margin: 0 });
    return canvas.toDataURL('image/png');
  } catch { return ''; }
}

type OrderRow = any;

function playBeep(ok: boolean) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.12;
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 90 : 220);
  } catch {}
}

export default function BarcodeScan() {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scanned, setScanned] = useState<OrderRow[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [statuses, setStatuses] = useState<{ id: string; name: string }[]>([]);
  const [couriers, setCouriers] = useState<{ id: string; full_name: string }[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [bulkStatusId, setBulkStatusId] = useState('');
  const [bulkCourierId, setBulkCourierId] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from('order_statuses').select('id,name').order('sort_order').then(({ data }) => setStatuses(data || []));
    supabase.from('profiles').select('id,full_name').then(async ({ data }) => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier' as any);
      const ids = new Set((roles || []).map((r: any) => r.user_id));
      setCouriers((data || []).filter((p: any) => ids.has(p.id)));
    });
  }, []);

  // Realtime: any update on scanned orders refreshes their row
  useEffect(() => {
    if (scanned.length === 0) return;
    const ids = scanned.map(o => o.id);
    const channel = supabase
      .channel('barcode-scan-orders')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload: any) => {
        if (ids.includes(payload.new.id)) {
          setScanned(prev => prev.map(o => o.id === payload.new.id ? { ...o, ...payload.new } : o));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scanned]);

  const startSession = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('scan_sessions')
      .insert({ user_id: user.id, status: 'active' })
      .select('id').single();
    if (error) { toast.error('فشل بدء الجلسة'); return; }
    setSessionId(data.id);
    setScanned([]);
    setTimeout(() => inputRef.current?.focus(), 50);
    toast.success('بدأت جلسة السكان — ابدأ المسح');
  };

  const logScan = (value: string, orderId: string | null, success: boolean, reason?: string) => {
    supabase.from('scan_logs').insert({
      user_id: user?.id, session_id: sessionId, scanned_value: value,
      order_id: orderId, success, error_reason: reason || null, action: 'scan',
    });
  };

  const handleScan = async (raw: string) => {
    const value = raw.trim();
    if (!value || !sessionId) return;
    setScanInput('');
    if (scanned.some(o => o.barcode === value || o.tracking_id === value || o.id === value)) {
      playBeep(false); toast.warning('هذا الأوردر تم سكانه بالفعل'); logScan(value, null, false, 'duplicate'); return;
    }
    const { data: orders } = await supabase
      .from('orders')
      .select('*, offices(name), order_statuses(name,color)')
      .or(`barcode.eq.${value},tracking_id.eq.${value}`)
      .limit(1);
    const order: any = orders?.[0];
    if (order?.courier_id) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', order.courier_id).maybeSingle();
      order.profiles = prof;
    }
    if (!order) {
      playBeep(false); toast.error(`لم يتم العثور على الأوردر: ${value}`); logScan(value, null, false, 'not_found'); return;
    }
    const statusName = order.order_statuses?.name || '';
    if (statusName === 'ملغي') {
      playBeep(false); toast.error('الأوردر ملغي — لا يمكن إضافته'); logScan(value, order.id, false, 'cancelled'); return;
    }
    if (order.is_closed) {
      playBeep(false); toast.warning('الأوردر مقفل بالفعل'); logScan(value, order.id, false, 'closed'); return;
    }
    await supabase.from('scan_session_items').insert({ session_id: sessionId, order_id: order.id });
    await supabase.from('scan_sessions').update({ items_count: scanned.length + 1 }).eq('id', sessionId);
    setScanned(prev => [order, ...prev]);
    playBeep(true);
    logScan(value, order.id, true);
  };

  const removeFromList = (id: string) => setScanned(prev => prev.filter(o => o.id !== id));

  const finish = async () => {
    if (scanned.length === 0) { toast.error('لم يتم سكان أي أوردر'); return; }
    setShowActions(true);
  };

  const applyBulkStatus = async () => {
    if (!bulkStatusId) { toast.error('اختر حالة'); return; }
    setBusy(true);
    const ids = scanned.map(o => o.id);
    const oldStatusMap = new Map(scanned.map(o => [o.id, o.status_id]));
    const { error } = await supabase.from('orders').update({ status_id: bulkStatusId }).in('id', ids);
    if (error) { toast.error('فشل التحديث'); setBusy(false); return; }
    await supabase.from('order_status_history').insert(
      ids.map(id => ({ order_id: id, old_status_id: oldStatusMap.get(id), new_status_id: bulkStatusId, changed_by: user?.id, source: 'barcode_scan' }))
    );
    await logActivity('bulk_status_update', { count: ids.length, status_id: bulkStatusId, source: 'scan' });
    toast.success(`تم تحديث حالة ${ids.length} أوردر`);
    setBusy(false);
  };

  const applyAssignCourier = async () => {
    if (!bulkCourierId) { toast.error('اختر مندوب'); return; }
    setBusy(true);
    const ids = scanned.map(o => o.id);
    const { error } = await supabase.from('orders').update({ courier_id: bulkCourierId }).in('id', ids);
    if (error) { toast.error('فشل التعيين'); setBusy(false); return; }
    await logActivity('bulk_assign_courier', { count: ids.length, courier_id: bulkCourierId });
    toast.success(`تم تعيين ${ids.length} أوردر للمندوب`);
    setBusy(false);
  };

  const applyUnassign = async () => {
    setBusy(true);
    const ids = scanned.map(o => o.id);
    await supabase.from('orders').update({ courier_id: null }).in('id', ids);
    await logActivity('bulk_unassign_courier', { count: ids.length });
    toast.success('تم إزالة تعيين المندوب');
    setBusy(false);
  };

  const applyClose = async () => {
    setBusy(true);
    const ids = scanned.map(o => o.id);
    await supabase.from('orders').update({ is_closed: true }).in('id', ids);
    await logActivity('bulk_close_orders', { count: ids.length, source: 'scan' });
    toast.success(`تم إقفال ${ids.length} أوردر`);
    setBusy(false);
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('جلسة سكان');
    ws.views = [{ rightToLeft: true }];
    ws.addRow(['الباركود', 'الكود', 'العميل', 'الهاتف', 'العنوان', 'المكتب', 'المندوب', 'الحالة', 'الإجمالي']);
    scanned.forEach(o => ws.addRow([
      o.barcode || '', o.customer_code || '', o.customer_name, o.customer_phone, o.address || '',
      o.offices?.name || '', o.profiles?.full_name || '', o.order_statuses?.name || '',
      Number(o.price) + Number(o.delivery_price),
    ]));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf]), `scan-session-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const printInvoices = async () => {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return;
    const pages = await Promise.all(scanned.map(async (o, i) => {
      const total = Number(o.price) + Number(o.delivery_price);
      const bc = barcodeDataUrl(o.barcode || '0');
      const qr = await QRCode.toDataURL(o.barcode || o.id, { width: 120, margin: 0 });
      return `<div class="page">
        <div class="h">Star Logistics</div>
        <div class="d">${new Date().toLocaleDateString('ar-EG')} — فاتورة ${i + 1}/${scanned.length}</div>
        <div class="codes"><img src="${bc}" /><img src="${qr}" /></div>
        <table>
          <tr><th>العميل</th><td>${o.customer_name}</td></tr>
          <tr><th>الهاتف</th><td dir="ltr">${o.customer_phone}</td></tr>
          <tr><th>المكتب</th><td>${o.offices?.name || '-'}</td></tr>
          <tr><th>العنوان</th><td>${o.address || '-'}</td></tr>
          <tr><th>المنتج</th><td>${o.product_name || '-'}</td></tr>
        </table>
        <div class="t">الإجمالي: ${total} ج.م</div>
      </div>`;
    }));
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>
      @page{size:A4;margin:15mm}body{font-family:'Cairo',Arial;margin:0}
      .page{page-break-after:always;padding:8mm 0}.page:last-child{page-break-after:auto}
      .h{text-align:center;font-size:24px;font-weight:bold}.d{text-align:center;color:#666;margin-bottom:14px}
      .codes{display:flex;justify-content:space-around;align-items:center;margin-bottom:12px;gap:14px}
      .codes img{max-height:90px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:8px;text-align:right}
      th{background:#f3f3f3;width:30%}.t{font-size:20px;font-weight:bold;text-align:center;border:2px solid #000;padding:10px;margin-top:10px}
    </style></head><body>${pages.join('')}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  const endSession = async () => {
    if (sessionId) {
      await supabase.from('scan_sessions').update({ ended_at: new Date().toISOString(), status: 'completed', items_count: scanned.length }).eq('id', sessionId);
    }
    setSessionId(null);
    setScanned([]);
    setShowActions(false);
    setBulkStatusId(''); setBulkCourierId('');
    toast.success('تم إنهاء الجلسة');
  };

  const totals = useMemo(() => ({
    count: scanned.length,
    amount: scanned.reduce((s, o) => s + Number(o.price) + Number(o.delivery_price), 0),
  }), [scanned]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ScanLine className="h-6 w-6 text-primary" />قراءة الباركود</h1>
        {sessionId && (
          <div className="flex gap-2 items-center">
            <Badge variant="secondary" className="text-sm">عدد: {totals.count}</Badge>
            <Badge variant="secondary" className="text-sm">إجمالي: {totals.amount} ج.م</Badge>
          </div>
        )}
      </div>

      {!sessionId ? (
        <Card className="bg-card">
          <CardContent className="py-16 flex flex-col items-center gap-4">
            <ScanLine className="h-16 w-16 text-primary" />
            <p className="text-muted-foreground">اضغط للبدء ثم استخدم جهاز الباركود (يعمل كلوحة مفاتيح)</p>
            <Button size="lg" className="text-lg px-10 py-6" onClick={startSession}>
              <Play className="h-5 w-5 ml-2" /> ابدأ الاسكان
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-card border-primary/40">
            <CardHeader className="pb-2"><CardTitle className="text-base">امسح الباركود الآن</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input
                ref={inputRef}
                autoFocus
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(scanInput); } }}
                onBlur={() => setTimeout(() => inputRef.current?.focus(), 100)}
                placeholder="ضع المؤشر هنا وامسح..."
                className="text-xl h-14 text-center font-mono"
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={finish} disabled={scanned.length === 0}>
                  <CheckCircle2 className="h-4 w-4 ml-1" /> انتهيت ({scanned.length})
                </Button>
                <Button variant="outline" onClick={endSession}>
                  <X className="h-4 w-4 ml-1" /> إلغاء الجلسة
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الباركود</TableHead>
                    <TableHead className="text-right">العميل</TableHead>
                    <TableHead className="text-right">المندوب</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead className="text-right">العنوان</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scanned.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">لم يتم سكان أي أوردر بعد</TableCell></TableRow>
                  ) : scanned.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono">{o.barcode}</TableCell>
                      <TableCell>{o.customer_name}</TableCell>
                      <TableCell>{o.profiles?.full_name || '-'}</TableCell>
                      <TableCell>
                        <Badge style={{ backgroundColor: o.order_statuses?.color || '#666', color: '#fff' }}>
                          {o.order_statuses?.name || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-bold">{Number(o.price) + Number(o.delivery_price)} ج.م</TableCell>
                      <TableCell className="text-sm">{o.address || '-'}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => removeFromList(o.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={showActions} onOpenChange={setShowActions}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>الإجراءات الجماعية ({scanned.length} أوردر)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">تغيير الحالة</label>
              <div className="flex gap-2">
                <Select value={bulkStatusId} onValueChange={setBulkStatusId}>
                  <SelectTrigger><SelectValue placeholder="اختر حالة" /></SelectTrigger>
                  <SelectContent>{statuses.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={applyBulkStatus} disabled={busy}>تطبيق</Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">تعيين مندوب</label>
              <div className="flex gap-2">
                <Select value={bulkCourierId} onValueChange={setBulkCourierId}>
                  <SelectTrigger><SelectValue placeholder="اختر مندوب" /></SelectTrigger>
                  <SelectContent>{couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={applyAssignCourier} disabled={busy}><UserPlus className="h-4 w-4 ml-1" />تعيين</Button>
                <Button variant="outline" onClick={applyUnassign} disabled={busy}><UserMinus className="h-4 w-4 ml-1" />إزالة</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t">
              <Button variant="outline" onClick={applyClose} disabled={busy}><Lock className="h-4 w-4 ml-1" />إقفال</Button>
              <Button variant="outline" onClick={printInvoices}><Printer className="h-4 w-4 ml-1" />طباعة فواتير</Button>
              <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
              <Button variant="outline" onClick={printInvoices}><FileText className="h-4 w-4 ml-1" />PDF</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowActions(false)}>إغلاق</Button>
            <Button onClick={endSession}>إنهاء الجلسة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
