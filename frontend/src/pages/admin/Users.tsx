import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, Shield, UserCheck, UserX, Trash2,
  RefreshCw, ChevronDown, MoreVertical, Eye, CheckCircle
} from 'lucide-react';
import api from '@/api/axios';
import { User } from '@/types';
import toast from 'react-hot-toast';
import { Helmet } from 'react-helmet-async';

const ROLE_COLORS: Record<string, string> = {
  superadmin: 'badge-error',
  admin: 'badge-warning',
  seller: 'badge-primary',
  user: 'badge-neutral',
};

const AdminUsers = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', role: '', isActive: '', isBanned: '', sort: '-createdAt' });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20, ...filters };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      const { data } = await api.get('/admin/users', { params });
      setUsers(data.data);
      setPagination(data.pagination);
    } catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchUsers(1); }, [filters]);

  const handleUpdateUser = async (userId: string, update: Partial<User>) => {
    try {
      await api.put(`/admin/users/${userId}`, update);
      toast.success('User updated');
      fetchUsers(pagination.page);
    } catch { toast.error('Update failed'); }
    setActionMenuId(null);
  };

  const handleApproveSeller = async (userId: string) => {
    try {
      await api.post(`/admin/users/${userId}/approve-seller`);
      toast.success('Seller approved!');
      fetchUsers(pagination.page);
    } catch { toast.error('Approval failed'); }
    setActionMenuId(null);
  };

  const handleBan = async (user: User) => {
    const reason = prompt(`Reason for ${user.isBanned ? 'unbanning' : 'banning'} ${user.name}:`);
    if (reason === null) return;
    await handleUpdateUser(user._id, { isBanned: !user.isBanned, banReason: reason });
  };

  return (
    <>
      <Helmet><title>Users | Admin — CartLy</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-2xl font-black tracking-tighter">Users</h1>
            <p className="text-sm text-outline mt-0.5">{pagination.total.toLocaleString()} total users</p>
          </div>
          <button onClick={() => fetchUsers(1)} className="btn-ghost text-xs">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant transition-all"
              />
            </div>

            {[
              { key: 'role', label: 'Role', options: [['', 'All Roles'], ['user', 'Users'], ['seller', 'Sellers'], ['admin', 'Admins']] },
              { key: 'isActive', label: 'Status', options: [['', 'All'], ['true', 'Active'], ['false', 'Inactive']] },
              { key: 'isBanned', label: 'Banned', options: [['', 'All'], ['false', 'Not Banned'], ['true', 'Banned']] },
              { key: 'sort', label: 'Sort', options: [['-createdAt', 'Newest'], ['createdAt', 'Oldest'], ['name', 'A-Z'], ['-name', 'Z-A']] },
            ].map(({ key, label, options }) => (
              <div key={key} className="relative">
                <select
                  value={(filters as any)[key]}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                  className="appearance-none pl-3 pr-7 py-2 text-sm bg-surface-low border border-transparent rounded-md focus:outline-none focus:border-outline-variant transition-all cursor-pointer"
                >
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Seller</th>
                  <th>Joined</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j}><div className="h-4 skeleton rounded w-24" /></td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-outline">No users found</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user._id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full editorial-gradient flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {user.name[0]?.toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-on-surface text-sm">{user.name}</p>
                            <p className="text-xs text-outline">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${ROLE_COLORS[user.role] || 'badge-neutral'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-col gap-1">
                          <span className={`badge text-[10px] ${user.isActive ? 'badge-success' : 'badge-error'}`}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                          {user.isBanned && <span className="badge badge-error text-[10px]">Banned</span>}
                          {!user.isEmailVerified && <span className="badge badge-warning text-[10px]">Unverified</span>}
                        </div>
                      </td>
                      <td>
                        {user.role === 'seller' && (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-on-surface-variant">{user.sellerProfile?.storeName || '—'}</span>
                            {user.sellerProfile && (
                              <span className={`badge text-[10px] ${user.sellerProfile.isApproved ? 'badge-success' : 'badge-warning'}`}>
                                {user.sellerProfile.isApproved ? 'Approved' : 'Pending'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="text-xs text-outline">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-outline">
                          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
                        </span>
                      </td>
                      <td>
                        <div className="relative">
                          <button
                            onClick={() => setActionMenuId(actionMenuId === user._id ? null : user._id)}
                            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-container transition-colors"
                          >
                            <MoreVertical size={15} />
                          </button>

                          {actionMenuId === user._id && (
                            <div className="absolute right-0 top-8 w-48 bg-white rounded-lg shadow-editorial-lg border border-outline-variant/20 py-1 z-10">
                              {user.role === 'seller' && !user.sellerProfile?.isApproved && (
                                <button
                                  onClick={() => handleApproveSeller(user._id)}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-xs text-success hover:bg-green-50 transition-colors"
                                >
                                  <CheckCircle size={13} /> Approve Seller
                                </button>
                              )}
                              <button
                                onClick={() => handleUpdateUser(user._id, { isActive: !user.isActive })}
                                className="w-full flex items-center gap-2 px-4 py-2 text-xs text-on-surface-variant hover:bg-surface-low transition-colors"
                              >
                                {user.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                                {user.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={() => handleBan(user)}
                                className={`w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-red-50 transition-colors ${user.isBanned ? 'text-success' : 'text-error'}`}
                              >
                                <Shield size={13} />
                                {user.isBanned ? 'Unban User' : 'Ban User'}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-outline-variant/10">
              <p className="text-xs text-outline">
                Page {pagination.page} of {pagination.pages} ({pagination.total} total)
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchUsers(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="btn-ghost text-xs disabled:opacity-40"
                >← Prev</button>
                <button
                  onClick={() => fetchUsers(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages}
                  className="btn-ghost text-xs disabled:opacity-40"
                >Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AdminUsers;
