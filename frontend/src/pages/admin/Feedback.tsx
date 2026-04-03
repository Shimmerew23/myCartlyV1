import { useEffect, useState, useCallback } from 'react';
import { MessageSquare, RefreshCw, ChevronDown, CheckCircle, Eye, Star } from 'lucide-react';
import api from '@/api/axios';
import { Helmet } from 'react-helmet-async';

interface FeedbackUser { _id: string; name: string; email: string; role: string; avatar?: string; }
interface FeedbackItem {
  _id: string;
  user?: FeedbackUser;
  guestName?: string;
  guestEmail?: string;
  category: 'bug' | 'feature' | 'general' | 'complaint' | 'praise';
  subject: string;
  message: string;
  rating?: number;
  status: 'new' | 'read' | 'resolved';
  adminNote?: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug Report',
  feature: 'Feature Request',
  general: 'General',
  complaint: 'Complaint',
  praise: 'Praise',
};

const CATEGORY_BADGE: Record<string, string> = {
  bug: 'badge-error',
  feature: 'badge-primary',
  general: 'badge-neutral',
  complaint: 'badge-warning',
  praise: 'badge-success',
};

const STATUS_BADGE: Record<string, string> = {
  new: 'badge-error',
  read: 'badge-warning',
  resolved: 'badge-success',
};

const AdminFeedback = () => {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', category: '' });
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchFeedbacks = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      const { data } = await api.get('/admin/feedback', { params });
      setFeedbacks(data.data);
      setPagination(data.pagination);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchFeedbacks(1); }, [filters]);

  const openDetail = async (item: FeedbackItem) => {
    setSelected(item);
    setAdminNote(item.adminNote || '');
    // Auto-mark as read
    if (item.status === 'new') {
      try {
        await api.put(`/admin/feedback/${item._id}`, { status: 'read' });
        setFeedbacks((prev) =>
          prev.map((f) => (f._id === item._id ? { ...f, status: 'read' } : f))
        );
      } catch { /* ignore */ }
    }
  };

  const handleStatusUpdate = async (status: 'new' | 'read' | 'resolved') => {
    if (!selected) return;
    setUpdating(true);
    try {
      await api.put(`/admin/feedback/${selected._id}`, { status, adminNote });
      setFeedbacks((prev) =>
        prev.map((f) => (f._id === selected._id ? { ...f, status, adminNote } : f))
      );
      setSelected({ ...selected, status, adminNote });
      if (status === 'resolved') setSelected(null);
    } catch { /* ignore */ } finally {
      setUpdating(false);
    }
  };

  const stats = {
    total: pagination.total,
    newCount: feedbacks.filter((f) => f.status === 'new').length,
  };

  return (
    <>
      <Helmet><title>Feedback | Admin</title></Helmet>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">Feedback</h1>
            <p className="text-sm text-outline mt-0.5">
              {pagination.total.toLocaleString()} submissions
              {stats.newCount > 0 && (
                <span className="ml-2 badge badge-error text-[10px]">{stats.newCount} new</span>
              )}
            </p>
          </div>
          <button onClick={() => fetchFeedbacks(1)} className="btn-ghost text-xs">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="card p-4 flex flex-wrap gap-3">
          <div className="relative">
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="read">Read</option>
              <option value="resolved">Resolved</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-5">
          {/* Table */}
          <div className="card overflow-hidden flex-1 min-w-0">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Subject</th>
                    <th>Category</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [...Array(8)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(7)].map((_, j) => (
                            <td key={j}><div className="h-4 skeleton rounded w-20" /></td>
                          ))}
                        </tr>
                      ))
                    : feedbacks.length === 0
                    ? (
                        <tr>
                          <td colSpan={7} className="text-center py-16">
                            <MessageSquare size={32} className="text-outline mx-auto mb-2" />
                            <p className="text-outline text-sm">No feedback found</p>
                          </td>
                        </tr>
                      )
                    : feedbacks.map((item) => (
                        <tr
                          key={item._id}
                          className={`cursor-pointer transition-colors ${selected?._id === item._id ? 'bg-surface-low' : 'hover:bg-surface-low/50'}`}
                          onClick={() => openDetail(item)}
                        >
                          <td>
                            <div>
                              <p className="text-xs font-semibold">
                                {item.user?.name || item.guestName || <span className="text-outline italic">Guest</span>}
                              </p>
                              <p className="text-xs text-outline">
                                {item.user?.email || item.guestEmail || '—'}
                              </p>
                            </div>
                          </td>
                          <td>
                            <p className="text-xs font-medium truncate max-w-[160px]">{item.subject}</p>
                          </td>
                          <td>
                            <span className={`badge ${CATEGORY_BADGE[item.category]} text-[10px]`}>
                              {CATEGORY_LABELS[item.category]}
                            </span>
                          </td>
                          <td>
                            {item.rating ? (
                              <span className="flex items-center gap-1 text-xs font-semibold">
                                <Star size={11} className="fill-amber-400 text-amber-400" />
                                {item.rating}
                              </span>
                            ) : (
                              <span className="text-xs text-outline">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${STATUS_BADGE[item.status]} text-[10px]`}>
                              {item.status}
                            </span>
                          </td>
                          <td>
                            <span className="text-xs text-outline font-mono">
                              {new Date(item.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td>
                            <button className="text-outline hover:text-on-surface transition-colors">
                              <Eye size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 && (
              <div className="flex justify-between items-center px-6 py-3 border-t border-outline-variant/10">
                <p className="text-xs text-outline">
                  Page {pagination.page} of {pagination.pages} ({pagination.total} entries)
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => fetchFeedbacks(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="btn-ghost text-xs disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => fetchFeedbacks(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    className="btn-ghost text-xs disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selected && (
            <div className="card w-80 flex-shrink-0 p-5 space-y-4 self-start sticky top-6">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-headline font-bold text-sm leading-tight">{selected.subject}</h2>
                <button
                  onClick={() => setSelected(null)}
                  className="text-outline hover:text-on-surface text-xs flex-shrink-0"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className={`badge ${CATEGORY_BADGE[selected.category]} text-[10px]`}>
                  {CATEGORY_LABELS[selected.category]}
                </span>
                <span className={`badge ${STATUS_BADGE[selected.status]} text-[10px]`}>
                  {selected.status}
                </span>
                {selected.rating && (
                  <span className="badge badge-neutral text-[10px] flex items-center gap-1">
                    <Star size={9} className="fill-amber-400 text-amber-400" />
                    {selected.rating}/5
                  </span>
                )}
              </div>

              <div className="text-xs text-outline space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-on-surface">
                    {selected.user?.name || selected.guestName || 'Anonymous'}
                  </p>
                  {!selected.user && (
                    <span className="badge badge-neutral text-[9px]">Guest</span>
                  )}
                </div>
                <p>{selected.user?.email || selected.guestEmail || '—'}</p>
                <p>{new Date(selected.createdAt).toLocaleString()}</p>
              </div>

              <div className="bg-surface-low rounded-md p-3">
                <p className="text-sm text-on-surface leading-relaxed">{selected.message}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-on-surface-variant">Admin Note</label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Add an internal note..."
                  rows={3}
                  className="w-full text-sm bg-surface-low border border-transparent rounded-md px-3 py-2 focus:outline-none focus:border-outline-variant resize-none"
                />
              </div>

              <div className="flex gap-2">
                {adminNote !== (selected.adminNote || '') && (
                  <button
                    onClick={() => handleStatusUpdate(selected.status === 'resolved' ? 'resolved' : 'read')}
                    disabled={updating}
                    className="btn-secondary text-xs flex-1 disabled:opacity-50"
                  >
                    {updating ? 'Saving…' : 'Save Note'}
                  </button>
                )}
                {selected.status !== 'resolved' && (
                  <button
                    onClick={() => handleStatusUpdate('resolved')}
                    disabled={updating}
                    className="btn-primary text-xs flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle size={13} />
                    {updating ? 'Saving…' : 'Mark Resolved'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AdminFeedback;
