import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

type FeedbackSummary = {
    id: string;
    created_at: string;
    category: 'error' | 'suggestion';
    content_preview: string;
    reporter: { type: string; username?: string | null };
    hook: { status?: string };
    has_screenshot: boolean;
};

const getReporterText = (reporter: FeedbackSummary['reporter']) => {
    if (!reporter) return 'unknown';
    if (reporter.type === 'guest') return 'guest';
    if (reporter.type === 'named_user' && reporter.username) return reporter.username;
    if (reporter.type === 'anonymous_user') return 'anonymous_user';
    return reporter.type || 'unknown';
};

export const FeedbackAdminModal: React.FC = () => {
    const { isOpen, user } = useStore(useShallow((state) => ({
        isOpen: state.modals.feedbackAdminModalOpen,
        user: state.user
    })));
    const setModalState = useStore((state) => state.setModalState);
    const { t } = useTranslation();

    const [items, setItems] = useState<FeedbackSummary[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [categoryFilter, setCategoryFilter] = useState<'all' | 'error' | 'suggestion'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');

    const onClose = () => setModalState({ feedbackAdminModalOpen: false });

    const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

    const loadList = async (reset = true) => {
        if (!user?.token) return;
        if (reset) {
            setLoadingList(true);
        } else {
            setLoadingMore(true);
        }

        try {
            const res = await api.getFeedbackAdminList({
                cursor: reset ? undefined : cursor || undefined,
                limit: 20,
                category: categoryFilter === 'all' ? undefined : categoryFilter,
                status: statusFilter === 'all' ? undefined : statusFilter
            }, user.token);
            const nextItems = Array.isArray(res.items) ? res.items : [];
            if (reset) {
                setItems(nextItems);
                setSelectedId(nextItems[0]?.id || null);
                setDetail(null);
            } else {
                setItems((prev) => {
                    const existing = new Set(prev.map((i) => i.id));
                    const merged = [...prev];
                    nextItems.forEach((i: FeedbackSummary) => {
                        if (!existing.has(i.id)) merged.push(i);
                    });
                    return merged;
                });
            }
            setCursor(res.cursor || null);
            setHasMore(Boolean(res.has_more && res.cursor));
        } catch (err: any) {
            toast.error(err?.message || t('feedback.adminLoadListFail', '加载反馈列表失败'));
        } finally {
            setLoadingList(false);
            setLoadingMore(false);
        }
    };

    const loadDetail = async (id: string) => {
        if (!user?.token || !id) return;
        setLoadingDetail(true);
        try {
            const res = await api.getFeedbackAdminItem(id, user.token);
            setDetail(res.item || null);
        } catch (err: any) {
            toast.error(err?.message || t('feedback.adminLoadItemFail', '加载反馈详情失败'));
        } finally {
            setLoadingDetail(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            setItems([]);
            setCursor(null);
            setHasMore(false);
            setSelectedId(null);
            setDetail(null);
            return;
        }
        if (!user || user.username !== 'admin') {
            toast.error(t('feedback.adminForbidden', '仅管理员可访问'));
            setModalState({ feedbackAdminModalOpen: false });
            return;
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            loadList(true).catch(() => undefined);
        }
    }, [categoryFilter, statusFilter]);

    useEffect(() => {
        if (!isOpen || !selectedId) return;
        loadDetail(selectedId).catch(() => undefined);
    }, [selectedId, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-6xl mx-auto h-[90vh] rounded-2xl shadow-2xl animate-slide-up flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-4 border-b flex items-center justify-between">
                    <div className="font-bold text-lg text-gray-800">{t('feedback.adminTitle', '反馈管理')}</div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 py-3 border-b flex flex-wrap gap-2 items-center bg-gray-50">
                    <select
                        className="px-3 py-1.5 text-sm border rounded-lg bg-white"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value as any)}
                    >
                        <option value="all">{t('feedback.allCategory', '全部分类')}</option>
                        <option value="error">{t('feedback.error', '报错')}</option>
                        <option value="suggestion">{t('feedback.suggestion', '建议')}</option>
                    </select>
                    <select
                        className="px-3 py-1.5 text-sm border rounded-lg bg-white"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                        <option value="all">{t('feedback.allStatus', '全部状态')}</option>
                        <option value="pending">pending</option>
                        <option value="success">success</option>
                        <option value="failed">failed</option>
                    </select>
                    <button
                        onClick={() => loadList(true)}
                        className="px-3 py-1.5 text-sm border rounded-lg bg-white hover:bg-gray-100 flex items-center gap-1"
                        disabled={loadingList}
                    >
                        {loadingList ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {t('common.refresh', '刷新')}
                    </button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                    <div className="md:w-[42%] border-r min-h-0 flex flex-col">
                        <div className="flex-1 overflow-y-auto">
                            {loadingList ? (
                                <div className="h-full flex items-center justify-center text-gray-500">
                                    <Loader2 size={18} className="animate-spin mr-2" />
                                    {t('feedback.loadingList', '加载中...')}
                                </div>
                            ) : items.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                    {t('feedback.noData', '暂无反馈')}
                                </div>
                            ) : (
                                items.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => setSelectedId(item.id)}
                                        className={`w-full text-left p-3 border-b hover:bg-gray-50 ${item.id === selectedId ? 'bg-blue-50' : 'bg-white'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <span className="text-xs font-bold text-gray-700">{item.category === 'error' ? t('feedback.error', '报错') : t('feedback.suggestion', '建议')}</span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.hook?.status === 'success' ? 'bg-emerald-100 text-emerald-700' : item.hook?.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {item.hook?.status || 'pending'}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-500 mb-1">{new Date(item.created_at).toLocaleString()}</div>
                                        <div className="text-sm text-gray-800 line-clamp-2">{item.content_preview}</div>
                                        <div className="text-[11px] text-gray-400 mt-1">reporter: {getReporterText(item.reporter)}</div>
                                    </button>
                                ))
                            )}
                        </div>
                        {hasMore && (
                            <button
                                onClick={() => loadList(false)}
                                disabled={loadingMore}
                                className="m-3 px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 disabled:opacity-60"
                            >
                                {loadingMore ? t('feedback.loadingMore', '加载中...') : t('feedback.loadMore', '加载更多')}
                            </button>
                        )}
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        {!selectedItem ? (
                            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                {t('feedback.pickOne', '请选择一条反馈')}
                            </div>
                        ) : loadingDetail ? (
                            <div className="h-full flex items-center justify-center text-gray-500">
                                <Loader2 size={18} className="animate-spin mr-2" />
                                {t('feedback.loadingDetail', '加载详情...')}
                            </div>
                        ) : !detail ? (
                            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                {t('feedback.noDetail', '详情为空')}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="rounded-lg border p-3 bg-gray-50">
                                    <div className="text-xs text-gray-500 mb-1">ID</div>
                                    <div className="text-sm font-mono break-all">{detail.id}</div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="rounded-lg border p-3">
                                        <div className="text-xs text-gray-500 mb-1">{t('feedback.category', '分类')}</div>
                                        <div className="text-sm">{detail.category === 'error' ? t('feedback.error', '报错') : t('feedback.suggestion', '建议')}</div>
                                    </div>
                                    <div className="rounded-lg border p-3">
                                        <div className="text-xs text-gray-500 mb-1">{t('feedback.createdAt', '提交时间')}</div>
                                        <div className="text-sm">{new Date(detail.created_at).toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-lg border p-3">
                                        <div className="text-xs text-gray-500 mb-1">reporter</div>
                                        <div className="text-sm">{getReporterText(detail.reporter)}</div>
                                    </div>
                                    <div className="rounded-lg border p-3">
                                        <div className="text-xs text-gray-500 mb-1">hook</div>
                                        <div className="text-sm">
                                            {detail.hook?.status || 'pending'}
                                            {detail.hook?.issue_url && (
                                                <>
                                                    {' '}· <a className="text-blue-600 hover:underline" href={detail.hook.issue_url} target="_blank" rel="noreferrer">issue</a>
                                                </>
                                            )}
                                        </div>
                                        {detail.hook?.error && <div className="text-xs text-red-500 mt-1 break-all">{detail.hook.error}</div>}
                                    </div>
                                </div>

                                <div className="rounded-lg border p-3">
                                    <div className="text-xs text-gray-500 mb-1">{t('feedback.content', '内容')}</div>
                                    <pre className="text-sm whitespace-pre-wrap break-words">{detail.content}</pre>
                                </div>

                                <div className="rounded-lg border p-3">
                                    <div className="text-xs text-gray-500 mb-2">{t('feedback.clientMeta', '客户端信息')}</div>
                                    <pre className="text-xs whitespace-pre-wrap break-all text-gray-600">{JSON.stringify(detail.client_meta || {}, null, 2)}</pre>
                                </div>

                                {detail.screenshot_url && (
                                    <div className="rounded-lg border p-3">
                                        <div className="text-xs text-gray-500 mb-2">{t('feedback.screenshot', '截图')}</div>
                                        <a href={detail.screenshot_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                                            {t('feedback.openImage', '在新窗口打开')}
                                        </a>
                                        <img src={detail.screenshot_url} alt="feedback screenshot" className="mt-2 max-w-full rounded border" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
