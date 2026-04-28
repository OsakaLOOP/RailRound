import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

type IssueState = 'open' | 'closed' | 'deleted' | null;

type FeedbackHook = {
  status?: string;
  issue_match_mode?: string | null;
  issue_number?: number | null;
  issue_state?: IssueState;
  issue_title?: string | null;
  issue_labels?: string[];
  issue_updated_at?: string | null;
  issue_url?: string | null;
  last_comment?: {
    author: string;
    created_at: string;
    body_preview: string;
  } | null;
  error?: string | null;
};

type FeedbackSummary = {
  id: string;
  created_at: string;
  category: 'error' | 'suggestion';
  error_module?: string | null;
  content_preview: string;
  reporter: { type: string; username?: string | null };
  hook: FeedbackHook;
  has_screenshot: boolean;
};

type FeedbackDetail = FeedbackSummary & {
  content: string;
  client_meta?: Record<string, unknown>;
  screenshot_url?: string | null;
};

const ERROR_MODULE_OPTIONS = ['routing', 'map', 'auth', 'sync', 'i18n', 'ui', 'performance', 'other'] as const;
type ErrorModule = (typeof ERROR_MODULE_OPTIONS)[number];
const ERROR_MODULE_LABEL_FALLBACK: Record<ErrorModule, string> = {
  routing: 'Routing',
  map: 'Map',
  auth: 'Authentication',
  sync: 'Sync',
  i18n: 'Localization',
  ui: 'UI',
  performance: 'Performance',
  other: 'Other'
};

const getReporterText = (reporter: FeedbackSummary['reporter']) => {
  if (!reporter) return 'unknown';
  if (reporter.type === 'guest') return 'guest';
  if (reporter.type === 'named_user' && reporter.username) return reporter.username;
  if (reporter.type === 'anonymous_user') return 'anonymous_user';
  return reporter.type || 'unknown';
};

const getIssueStateClass = (state: IssueState) => {
  if (state === 'open') return 'bg-emerald-100 text-emerald-700';
  if (state === 'closed') return 'bg-gray-200 text-gray-700';
  if (state === 'deleted') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
};

const getIssueStateText = (state: IssueState) => {
  if (state === 'open') return 'open';
  if (state === 'closed') return 'closed';
  if (state === 'deleted') return 'deleted';
  return 'unbound';
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
  const [loadingSync, setLoadingSync] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'error' | 'suggestion'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');

  const getErrorModuleLabel = (moduleName?: string | null) => {
    if (!moduleName) return '-';
    if (!ERROR_MODULE_OPTIONS.includes(moduleName as ErrorModule)) return moduleName;
    const module = moduleName as ErrorModule;
    const key = `feedback.errorModuleOptions.${module}`;
    const translated = t(key);
    return translated === key ? ERROR_MODULE_LABEL_FALLBACK[module] : translated;
  };

  const onClose = useCallback(() => setModalState({ feedbackAdminModalOpen: false }), [setModalState]);
const onCloseRef = useRef(onClose);
onCloseRef.current = onClose;
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  const loadList = async (reset = true) => {
    if (!user?.token) return;
    if (reset) {
      setLoadingList(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const safeCursor =
        !reset && typeof cursor === 'string' && cursor && cursor !== 'undefined' && cursor !== 'null'
          ? cursor
          : undefined;
      const res = await api.getFeedbackAdminList({
        cursor: safeCursor,
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
      toast.error(err?.message || t('feedback.adminLoadListFail', 'Failed to load feedback list'));
    } finally {
      setLoadingList(false);
      setLoadingMore(false);
    }
  };

  const syncAndLoadList = async (reset = true) => {
    if (!user?.token) return;
    if (reset) {
      setLoadingSync(true);
    }
    try {
      await api.syncFeedbackGithub(user.token);
    } catch (err: any) {
      toast.error(err?.message || t('feedback.adminSyncGithubFail', 'GitHub sync failed'));
    } finally {
      if (reset) {
        setLoadingSync(false);
      }
    }
    await loadList(reset);
  };

  const loadDetail = async (id: string) => {
    if (!user?.token || !id) return;
    setLoadingDetail(true);
    try {
      const res = await api.getFeedbackAdminItem(id, user.token);
      setDetail((res.item || null) as FeedbackDetail | null);
    } catch (err: any) {
      toast.error(err?.message || t('feedback.adminLoadItemFail', 'Failed to load feedback detail'));
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
      toast.error(t('feedback.adminForbidden', 'Admin only'));
      setModalState({ feedbackAdminModalOpen: false });
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setModalState, t, user]);

  useEffect(() => {
    if (isOpen) {
      syncAndLoadList(true).catch(() => undefined);
    }
  }, [categoryFilter, isOpen, statusFilter]);

  useEffect(() => {
    if (!isOpen || !selectedId) return;
    loadDetail(selectedId).catch(() => undefined);
  }, [selectedId, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-6xl mx-auto h-[90vh] rounded-2xl shadow-2xl animate-slide-up flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-bold text-lg text-gray-800">{t('feedback.adminTitle', 'Feedback Admin')}</div>
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
            <option value="all">{t('feedback.allCategory', 'All categories')}</option>
            <option value="error">{t('feedback.error', 'Error')}</option>
            <option value="suggestion">{t('feedback.suggestion', 'Suggestion')}</option>
          </select>
          <select
            className="px-3 py-1.5 text-sm border rounded-lg bg-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">{t('feedback.allStatus', 'All statuses')}</option>
            <option value="pending">pending</option>
            <option value="success">success</option>
            <option value="failed">failed</option>
          </select>
          <button
            onClick={() => syncAndLoadList(true)}
            className="px-3 py-1.5 text-sm border rounded-lg bg-white hover:bg-gray-100 flex items-center gap-1"
            disabled={loadingList || loadingSync}
          >
            {loadingList || loadingSync ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('common.refresh', 'Refresh')}
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="md:w-[42%] border-r min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <Loader2 size={18} className="animate-spin mr-2" />
                  {t('feedback.loadingList', 'Loading...')}
                </div>
              ) : items.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  {t('feedback.noData', 'No data')}
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left p-3 border-b hover:bg-gray-50 ${item.id === selectedId ? 'bg-blue-50' : 'bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-700">{item.category === 'error' ? t('feedback.error', 'Error') : t('feedback.suggestion', 'Suggestion')}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getIssueStateClass(item.hook?.issue_state || null)}`}>
                        {getIssueStateText(item.hook?.issue_state || null)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">{new Date(item.created_at).toLocaleString()}</div>
                    {item.error_module && (
                      <div className="text-[11px] text-gray-500 mb-1">module: {getErrorModuleLabel(item.error_module)}</div>
                    )}
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
                {loadingMore ? t('feedback.loadingMore', 'Loading...') : t('feedback.loadMore', 'Load more')}
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!selectedItem ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {t('feedback.pickOne', 'Select one feedback')}
              </div>
            ) : loadingDetail ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <Loader2 size={18} className="animate-spin mr-2" />
                {t('feedback.loadingDetail', 'Loading detail...')}
              </div>
            ) : !detail ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {t('feedback.noDetail', 'No detail')}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border p-3 bg-gray-50">
                  <div className="text-xs text-gray-500 mb-1">ID</div>
                  <div className="text-sm font-mono break-all">{detail.id}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-gray-500 mb-1">{t('feedback.category', 'Category')}</div>
                    <div className="text-sm">{detail.category === 'error' ? t('feedback.error', 'Error') : t('feedback.suggestion', 'Suggestion')}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-gray-500 mb-1">{t('feedback.createdAt', 'Created At')}</div>
                    <div className="text-sm">{new Date(detail.created_at).toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-gray-500 mb-1">reporter</div>
                    <div className="text-sm">{getReporterText(detail.reporter)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-gray-500 mb-1">{t('feedback.errorModule', 'Error Module')}</div>
                    <div className="text-sm">{getErrorModuleLabel(detail.error_module)}</div>
                  </div>
                  <div className="rounded-lg border p-3 md:col-span-2">
                    <div className="text-xs text-gray-500 mb-1">github issue</div>
                    <div className="text-sm flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getIssueStateClass(detail.hook?.issue_state || null)}`}>
                        {getIssueStateText(detail.hook?.issue_state || null)}
                      </span>
                      {detail.hook?.issue_number ? (
                        <span className="font-mono">#{detail.hook.issue_number}</span>
                      ) : (
                        <span className="text-gray-500">unbound issue id</span>
                      )}
                      {detail.hook?.issue_url && (
                        <a className="text-blue-600 hover:underline" href={detail.hook.issue_url} target="_blank" rel="noreferrer">issue</a>
                      )}
                    </div>
                    {detail.hook?.issue_title && (
                      <div className="text-sm text-gray-700 mt-1">{detail.hook.issue_title}</div>
                    )}
                    {detail.hook?.issue_updated_at && (
                      <div className="text-xs text-gray-500 mt-1">updated at: {new Date(detail.hook.issue_updated_at).toLocaleString()}</div>
                    )}
                    {detail.hook?.status && (
                      <div className="text-xs text-gray-500 mt-1">hook status: {detail.hook.status}</div>
                    )}
                    {detail.hook?.issue_match_mode && (
                      <div className="text-xs text-gray-500 mt-1">match mode: {detail.hook.issue_match_mode}</div>
                    )}
                    {detail.hook?.error && <div className="text-xs text-red-500 mt-1 break-all">{detail.hook.error}</div>}
                  </div>
                  <div className="rounded-lg border p-3 md:col-span-2">
                    <div className="text-xs text-gray-500 mb-1">labels</div>
                    {Array.isArray(detail.hook?.issue_labels) && detail.hook.issue_labels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.hook.issue_labels.map((label) => (
                          <span key={label} className="px-2 py-0.5 text-xs rounded-full border bg-white text-gray-700">{label}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">-</div>
                    )}
                  </div>
                  <div className="rounded-lg border p-3 md:col-span-2">
                    <div className="text-xs text-gray-500 mb-1">latest comment</div>
                    {detail.hook?.last_comment ? (
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500">
                          {detail.hook.last_comment.author} · {new Date(detail.hook.last_comment.created_at).toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                          {detail.hook.last_comment.body_preview}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">-</div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-gray-500 mb-1">{t('feedback.content', 'Content')}</div>
                  <pre className="text-sm whitespace-pre-wrap break-words">{detail.content}</pre>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-gray-500 mb-2">{t('feedback.clientMeta', 'Client Meta')}</div>
                  <pre className="text-xs whitespace-pre-wrap break-all text-gray-600">{JSON.stringify(detail.client_meta || {}, null, 2)}</pre>
                </div>

                {detail.screenshot_url && (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-gray-500 mb-2">{t('feedback.screenshot', 'Screenshot')}</div>
                    <a href={detail.screenshot_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                      {t('feedback.openImage', 'Open image in new tab')}
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
