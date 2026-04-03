import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, Send, MessageSquare } from 'lucide-react';
import api from '@/api/axios';
import { useAppSelector } from '@/store';

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'praise', label: 'Praise' },
];

const GUEST_LIMIT = 300;
const AUTH_LIMIT = 2000;

const FeedbackModal = ({ open, onClose }: Props) => {
  const { isAuthenticated } = useAppSelector((s) => s.auth);
  const messageLimit = isAuthenticated ? AUTH_LIMIT : GUEST_LIMIT;

  const [form, setForm] = useState({
    category: 'general',
    subject: '',
    message: '',
    rating: 0,
    guestName: '',
    guestEmail: '',
  });
  const [hoverRating, setHoverRating] = useState(0);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setForm({ category: 'general', subject: '', message: '', rating: 0, guestName: '', guestEmail: '' });
    setHoverRating(0);
    setSuccess(false);
    setError('');
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 300);
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= messageLimit) {
      setForm((f) => ({ ...f, message: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      setError('Subject and message are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/feedback', {
        category: form.category,
        subject: form.subject.trim(),
        message: form.message.trim(),
        ...(form.rating > 0 ? { rating: form.rating } : {}),
        ...(!isAuthenticated && form.guestName ? { guestName: form.guestName.trim() } : {}),
        ...(!isAuthenticated && form.guestEmail ? { guestEmail: form.guestEmail.trim() } : {}),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const remaining = messageLimit - form.message.length;
  const nearLimit = remaining <= 50;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="bg-white rounded-xl shadow-editorial-lg w-full max-w-md pointer-events-auto max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-outline-variant/20 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 editorial-gradient rounded-sm flex items-center justify-center">
                    <MessageSquare size={15} className="text-white" />
                  </div>
                  <div>
                    <h2 className="font-headline font-black text-sm tracking-tight">Send Feedback</h2>
                    <p className="text-xs text-outline">
                      {isAuthenticated ? 'We read every submission' : 'No account needed'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {success ? (
                <div className="px-6 py-10 text-center space-y-3">
                  <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                    <Send size={24} className="text-success" />
                  </div>
                  <p className="font-headline font-bold">Thank you for your feedback!</p>
                  <p className="text-sm text-outline">We appreciate you taking the time to share your thoughts.</p>
                  <button onClick={handleClose} className="btn-primary text-sm mt-2">
                    Close
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
                  {/* Guest name/email */}
                  {!isAuthenticated && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-on-surface-variant">
                          Name <span className="text-outline font-normal">(optional)</span>
                        </label>
                        <input
                          value={form.guestName}
                          onChange={(e) => setForm((f) => ({ ...f, guestName: e.target.value }))}
                          maxLength={80}
                          placeholder="Your name"
                          className="w-full px-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-on-surface-variant">
                          Email <span className="text-outline font-normal">(optional)</span>
                        </label>
                        <input
                          type="email"
                          value={form.guestEmail}
                          onChange={(e) => setForm((f) => ({ ...f, guestEmail: e.target.value }))}
                          maxLength={120}
                          placeholder="your@email.com"
                          className="w-full px-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant"
                        />
                      </div>
                    </div>
                  )}

                  {/* Category */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-on-surface-variant">Category</label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, category: cat.value }))}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                            form.category === cat.value
                              ? 'editorial-gradient text-white border-transparent'
                              : 'border-outline-variant/30 text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-on-surface-variant">Subject</label>
                    <input
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      maxLength={150}
                      placeholder="Brief summary of your feedback"
                      className="w-full px-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant"
                    />
                  </div>

                  {/* Message */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-on-surface-variant">Message</label>
                    <textarea
                      value={form.message}
                      onChange={handleMessageChange}
                      rows={4}
                      placeholder="Tell us more..."
                      className="w-full px-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant resize-none"
                    />
                    <div className="flex items-center justify-between">
                      {!isAuthenticated && (
                        <p className="text-xs text-outline">
                          Sign in for up to {AUTH_LIMIT.toLocaleString()} characters
                        </p>
                      )}
                      <p className={`text-xs ml-auto ${nearLimit ? 'text-warning font-semibold' : 'text-outline'}`}>
                        {remaining}/{messageLimit}
                      </p>
                    </div>
                  </div>

                  {/* Rating */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-on-surface-variant">
                      Overall experience <span className="text-outline font-normal">(optional)</span>
                    </label>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, rating: star === f.rating ? 0 : star }))}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star
                            size={22}
                            className={`transition-colors ${
                              star <= (hoverRating || form.rating)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-outline-variant'
                            }`}
                          />
                        </button>
                      ))}
                      {form.rating > 0 && (
                        <span className="text-xs text-outline ml-1">
                          {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][form.rating]}
                        </span>
                      )}
                    </div>
                  </div>

                  {error && (
                    <p className="text-xs text-error bg-error/5 rounded-md px-3 py-2">{error}</p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-1">
                    <button type="button" onClick={handleClose} className="btn-ghost text-sm flex-1">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary text-sm flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {loading ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      {loading ? 'Sending…' : 'Send Feedback'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default FeedbackModal;
