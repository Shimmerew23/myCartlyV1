import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import api from '@/api/axios';
import toast from 'react-hot-toast';

type Status = 'processing' | 'success' | 'error' | 'cancelled';

export default function PaypalReturn({ mode = 'return' }: { mode?: 'return' | 'cancel' }) {
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>(mode === 'cancel' ? 'cancelled' : 'processing');

  useEffect(() => {
    if (mode === 'cancel') return;
    if (!orderId) { setStatus('error'); return; }
    let active = true;
    (async () => {
      try {
        await api.post(`/orders/${orderId}/capture`);
        if (!active) return;
        setStatus('success');
        toast.success('Payment successful!');
        setTimeout(() => navigate(`/orders/${orderId}`), 1500);
      } catch (err: any) {
        if (!active) return;
        setStatus('error');
        toast.error(err.response?.data?.message || 'Payment could not be confirmed.');
      }
    })();
    return () => { active = false; };
  }, [orderId, mode, navigate]);

  return (
    <div className="max-w-md mx-auto py-24 px-4 text-center">
      {status === 'processing' && (
        <>
          <Loader2 className="mx-auto animate-spin text-primary-900" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Confirming your payment…</h1>
          <p className="text-outline text-sm mt-2">Please wait while we finalize your PayPal payment.</p>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle2 className="mx-auto text-green-600" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Payment successful</h1>
          <p className="text-outline text-sm mt-2">Redirecting to your order…</p>
        </>
      )}
      {status === 'cancelled' && (
        <>
          <XCircle className="mx-auto text-outline" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Payment cancelled</h1>
          <p className="text-outline text-sm mt-2">Your order is still pending. You can complete payment from your orders.</p>
          <Link to={orderId ? `/orders/${orderId}` : '/orders'} className="btn-primary inline-flex mt-6">View order</Link>
        </>
      )}
      {status === 'error' && (
        <>
          <XCircle className="mx-auto text-red-600" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">We couldn't confirm your payment</h1>
          <p className="text-outline text-sm mt-2">If you completed payment, it may take a moment. Check your order status.</p>
          <Link to={orderId ? `/orders/${orderId}` : '/orders'} className="btn-primary inline-flex mt-6">View order</Link>
        </>
      )}
    </div>
  );
}
