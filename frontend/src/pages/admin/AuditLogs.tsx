import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronDown, RefreshCw, FileText } from 'lucide-react';
import api from '@/api/axios';
import { Helmet } from 'react-helmet-async';

interface AuditLog { _id: string; user?: { name: string; email: string; role: string }; action: string; resource?: string; method?: string; path?: string; statusCode?: number; ip?: string; createdAt: string; }

const ACTION_COLORS: Record<string, string> = { CREATE_PRODUCT:'badge-success',UPDATE_PRODUCT:'badge-info',DELETE_PRODUCT:'badge-error',CREATE_ORDER:'badge-primary',UPDATE_USER:'badge-warning',APPROVE_SELLER:'badge-success',BAN_USER:'badge-error',LOGIN:'badge-neutral',LOGOUT:'badge-neutral' };

const AdminAuditLogs = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', resource: '' });

  const fetch = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25, ...filters };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data } = await api.get('/admin/audit-logs', { params });
      setLogs(data.data); setPagination(data.pagination);
    } catch {} finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetch(1); }, [filters]);

  return (
    <>
      <Helmet><title>Audit Logs | Admin</title></Helmet>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="font-headline text-2xl font-black tracking-tighter">Audit Logs</h1><p className="text-sm text-outline mt-0.5">{pagination.total.toLocaleString()} entries · 90-day retention</p></div>
          <button onClick={() => fetch(1)} className="btn-ghost text-xs"><RefreshCw size={14} /> Refresh</button>
        </div>
        <div className="card p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" /><input value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} placeholder="Filter by action..." className="w-full pl-9 pr-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant" /></div>
          <div className="relative"><select value={filters.resource} onChange={(e) => setFilters((f) => ({ ...f, resource: e.target.value }))} className="appearance-none pl-3 pr-8 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant cursor-pointer"><option value="">All Resources</option>{['User','Product','Order','Category','Coupon'].map((r) => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" /></div>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Resource</th><th>Method</th><th>Status</th><th>IP</th></tr></thead>
              <tbody>
                {loading ? [...Array(10)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="h-4 skeleton rounded w-20" /></td>)}</tr>)
                  : logs.length === 0 ? <tr><td colSpan={7} className="text-center py-12"><FileText size={32} className="text-outline mx-auto mb-2" /><p className="text-outline text-sm">No audit logs</p></td></tr>
                  : logs.map((log) => (
                  <tr key={log._id}>
                    <td><span className="text-xs text-outline font-mono">{new Date(log.createdAt).toLocaleString()}</span></td>
                    <td>{log.user ? (<><p className="text-xs font-semibold">{log.user.name}</p><p className="text-xs text-outline">{log.user.email}</p></>) : <span className="text-xs text-outline">System</span>}</td>
                    <td><span className={`badge ${ACTION_COLORS[log.action] || 'badge-neutral'} text-[10px]`}>{log.action?.replace(/_/g,' ') || '—'}</span></td>
                    <td><span className="text-xs text-outline">{log.resource || '—'}</span></td>
                    <td><span className={`font-mono text-xs font-semibold ${log.method === 'DELETE' ? 'text-error' : log.method === 'POST' ? 'text-success' : 'text-on-surface-variant'}`}>{log.method || '—'}</span></td>
                    <td><span className={`text-xs font-mono font-semibold ${log.statusCode && log.statusCode >= 400 ? 'text-error' : 'text-success'}`}>{log.statusCode || '—'}</span></td>
                    <td><span className="text-xs font-mono text-outline">{log.ip || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination.pages > 1 && (
            <div className="flex justify-between items-center px-6 py-3 border-t border-outline-variant/10">
              <p className="text-xs text-outline">Page {pagination.page} of {pagination.pages} ({pagination.total} entries)</p>
              <div className="flex gap-1"><button onClick={() => fetch(pagination.page - 1)} disabled={pagination.page <= 1} className="btn-ghost text-xs disabled:opacity-40">← Prev</button><button onClick={() => fetch(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="btn-ghost text-xs disabled:opacity-40">Next →</button></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AdminAuditLogs;
