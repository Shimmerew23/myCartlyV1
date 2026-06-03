import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import api from '@/api/axios';
import toast from 'react-hot-toast';

type Status = 'processing' | 'success' | 'pending' | 'error' | 'cancelled';

// GCash confirmation is webhook-driven (PayMongo source.chargeable → payment),
// so on return we poll the order a few times for paymentStatus: 'paid'.
const MAX_ATTEMPTS = 6;
const INTERVAL_MS = 2000;

export default function GcashReturn({ mode = 'return' }: { mode?: 'return' | 'cancel' }) {
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>(mode === 'cancel' ? 'cancelled' : 'processing');
  const attempts = useRef(0);

  useEffect(() => {
    if (mode === 'cancel') return;
    if (!orderId) { setStatus('error'); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data } = await api.get(`/orders/${orderId}`);
        if (!active) return;
        if (data.data?.paymentStatus === 'paid') {
          setStatus('success');
          toast.success('Payment successful!');
          setTimeout(() => navigate(`/orders/${orderId}`), 1500);
          return;
        }
        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) { setStatus('pending'); return; }
        timer = setTimeout(poll, INTERVAL_MS);
      } catch {
        if (!active) return;
        setStatus('error');
      }
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [orderId, mode, navigate]);

  return (
    <div className="max-w-md mx-auto py-24 px-4 text-center">
      {status === 'processing' && (
        <>
          <Loader2 className="mx-auto animate-spin text-primary-900" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Confirming your payment…</h1>
          <p className="text-outline text-sm mt-2">Please wait while we confirm your GCash payment.</p>
        </>
      )}
      {status === 'success' && (
        <>
          <CheckCircle2 className="mx-auto text-green-600" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Payment successful</h1>
          <p className="text-outline text-sm mt-2">Redirecting to your order…</p>
        </>
      )}
      {status === 'pending' && (
        <>
          <Clock className="mx-auto text-amber-500" size={40} />
          <h1 className="font-headline font-black text-xl mt-4">Payment is processing</h1>
          <p className="text-outline text-sm mt-2">This can take a moment to confirm. Your order status will update automatically.</p>
          <Link to={orderId ? `/orders/${orderId}` : '/orders'} className="btn-primary inline-flex mt-6">View order</Link>
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
