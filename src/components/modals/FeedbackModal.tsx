import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle, Lightbulb, Loader2, Image as ImageIcon, CheckCircle2, XCircle } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 2000;
const GITHUB_ISSUES_LIST_URL = 'https://github.com/OsakaLOOP/RailRound/issues';
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

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to process image'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });

async function compressImageToLimit(file: File, maxBytes = MAX_IMAGE_BYTES): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload an image file');
  }
  if (file.size <= maxBytes) {
    return file;
  }

  const img = await loadImageElement(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to process image in this browser');

  let width = img.naturalWidth;
  let height = img.naturalHeight;
  let quality = 0.9;
  const mime = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

  for (let i = 0; i < 12; i++) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, mime, quality);
    if (blob.size <= maxBytes) {
      const ext = mime === 'image/webp' ? 'webp' : 'jpg';
      const name = file.name.replace(/\.[^.]+$/, '') || `feedback-image-${Date.now()}`;
      return new File([blob], `${name}.${ext}`, { type: mime, lastModified: Date.now() });
    }

    if (quality > 0.45) {
      quality -= 0.1;
    } else {
      width *= 0.85;
      height *= 0.85;
      quality = 0.88;
    }
  }

  throw new Error('Image is still over 2MB after compression');
}

export const FeedbackModal: React.FC = () => {
  const { isOpen, user, userProfile, myFeedbackIds, addMyFeedbackId, appVersion } = useStore(
    useShallow((state) => ({
      isOpen: state.modals.feedbackModalOpen,
      user: state.user,
      userProfile: state.userProfile,
      myFeedbackIds: state.myFeedbackIds,
      addMyFeedbackId: state.addMyFeedbackId,
      appVersion: state.appVersion
    }))
  );
  const setModalState = useStore((state) => state.setModalState);
  const { t } = useTranslation();

  const [category, setCategory] = useState<'error' | 'suggestion'>('error');
  const [errorModule, setErrorModule] = useState<ErrorModule>('routing');
  const [content, setContent] = useState('');
  const [includeIdentity, setIncludeIdentity] = useState(false);
  const [submitAsGithubIdentity, setSubmitAsGithubIdentity] = useState(false);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmTicket, setConfirmTicket] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<'pending' | 'confirming' | 'confirmed' | 'failed'>('pending');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'write' | 'my-feedback'>('write');
  const [myIssues, setMyIssues] = useState<any[]>([]);
  const [myIssuesLoading, setMyIssuesLoading] = useState(false);
  const [myIssuesError, setMyIssuesError] = useState<string | null>(null);
  const [similarIssues, setSimilarIssues] = useState<any[]>([]);
  const [similarSearching, setSimilarSearching] = useState(false);
  const [lastSearchedContent, setLastSearchedContent] = useState('');
  const similarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const myIssuesFetchedRef = useRef(false);
  const getErrorModuleLabel = (module: ErrorModule) => {
    const key = `feedback.errorModuleOptions.${module}`;
    const translated = t(key);
    return translated === key ? ERROR_MODULE_LABEL_FALLBACK[module] : translated;
  };

  const onClose = () => setModalState({ feedbackModalOpen: false });

  useEffect(() => {
    if (!isOpen) {
      setCategory('error');
      setErrorModule('routing');
      setContent('');
      setIncludeIdentity(false);
      setSubmitAsGithubIdentity(false);
      setScreenshot(null);
      setIsProcessingImage(false);
      setIsSubmitting(false);
      setConfirmTicket(null);
      setConfirmStatus('pending');
      setConfirmError(null);
      setActiveTab('write');
      setMyIssues([]);
      setMyIssuesLoading(false);
      setMyIssuesError(null);
      setSimilarIssues([]);
      setSimilarSearching(false);
      setLastSearchedContent('');
      myIssuesFetchedRef.current = false;
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!user && includeIdentity) {
      setIncludeIdentity(false);
    }
  }, [user, includeIdentity]);

  const hasGithubBinding = Boolean(userProfile?.bindings?.github?.login);

  const fetchMyIssues = useCallback(async () => {
    setMyIssuesLoading(true);
    setMyIssuesError(null);
    try {
      const res = await api.getMyFeedbackIssues(user?.token || null, myFeedbackIds);
      setMyIssues(res.issues || []);
    } catch (err: any) {
      setMyIssuesError(err?.message || t('feedback.myIssuesError'));
    } finally {
      setMyIssuesLoading(false);
    }
  }, [user?.token, myFeedbackIds, t]);

  useEffect(() => {
    if (isOpen && activeTab === 'my-feedback' && !myIssuesFetchedRef.current && !myIssuesLoading) {
      myIssuesFetchedRef.current = true;
      fetchMyIssues();
    }
  }, [isOpen, activeTab, myIssuesLoading, fetchMyIssues]);

  useEffect(() => {
    if (!hasGithubBinding && submitAsGithubIdentity) {
      setSubmitAsGithubIdentity(false);
    }
  }, [hasGithubBinding, submitAsGithubIdentity]);

  useEffect(() => {
    return () => {
      if (similarTimerRef.current) clearTimeout(similarTimerRef.current);
    };
  }, []);

  const handleContentBlur = useCallback(() => {
    const trimmed = content.trim();
    if (trimmed.length < 10) {
      setSimilarIssues([]);
      return;
    }
    if (lastSearchedContent) {
      const maxLen = Math.max(trimmed.length, lastSearchedContent.length);
      const diff = Math.abs(trimmed.length - lastSearchedContent.length);
      if (diff / maxLen < 0.25) {
        const overlapLen = Math.min(30, lastSearchedContent.length);
        if (overlapLen > 0 && trimmed.startsWith(lastSearchedContent.slice(0, overlapLen))) {
          return;
        }
      }
    }
    if (similarTimerRef.current) clearTimeout(similarTimerRef.current);
    setSimilarSearching(true);
    similarTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.searchSimilarFeedback(trimmed, categoryRef.current, user?.token || null);
        setSimilarIssues(res.issues || []);
        setLastSearchedContent(trimmed);
      } catch {
        // silent
      } finally {
        setSimilarSearching(false);
      }
    }, 500);
  }, [content, user?.token, lastSearchedContent]);

  const screenshotHint = useMemo(() => {
    if (!screenshot) return t('feedback.noScreenshot');
    return `${screenshot.name} (${(screenshot.size / 1024 / 1024).toFixed(2)} MB)`;
  }, [screenshot, t]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!confirmTicket || confirmStatus === 'confirming' || confirmStatus === 'confirmed') return;
    setConfirmStatus('confirming');
    setConfirmError(null);
    try {
      const res = await api.confirmFeedbackIssue(confirmTicket, user?.token || null);
      const hook = res?.hook || {};
      if (hook?.status === 'success' && (hook?.issue_state === 'open' || hook?.issue_state === 'closed' || hook?.issue_state === 'deleted')) {
        setConfirmStatus('confirmed');
        const issueUrl = hook?.issue_url || '';
        if (issueUrl) {
          toast.success(
            <a href={issueUrl} target="_blank" rel="noreferrer" className="underline">
              {t('feedback.confirmSuccess')}
            </a>
          );
        } else {
          toast.success(t('feedback.confirmSuccess'));
        }
        setTimeout(() => onClose(), 1500);
        return;
      }
      setConfirmStatus('failed');
      setConfirmError(hook?.error || t('feedback.confirmNotFound'));
    } catch (err: any) {
      setConfirmStatus('failed');
      setConfirmError(err?.message || t('feedback.confirmFailed'));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('feedback.imageTypeError'));
      e.target.value = '';
      return;
    }

    setIsProcessingImage(true);
    try {
      const compressed = await compressImageToLimit(file, MAX_IMAGE_BYTES);
      setScreenshot(compressed);
      toast.success(t('feedback.imageReady'));
    } catch (err: any) {
      toast.error(err?.message || t('feedback.imageCompressError'));
      setScreenshot(null);
    } finally {
      setIsProcessingImage(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error(t('feedback.contentRequired'));
      return;
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      toast.error(t('feedback.contentTooLong'));
      return;
    }
    if (isProcessingImage || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('category', category);
      if (category === 'error') {
        formData.append('errorModule', errorModule);
      }
      formData.append('content', trimmed);
      formData.append('includeIdentity', includeIdentity ? 'true' : 'false');
      formData.append('issue_submit_mode', submitAsGithubIdentity ? 'github_user_manual' : 'system_auto');
      formData.append('lang', navigator.language || '');
      formData.append('path', `${window.location.pathname}${window.location.search}`);
      formData.append('appVersion', appVersion);
      if (screenshot) {
        formData.append('screenshot', screenshot, screenshot.name);
      }

      const submitRes = await api.submitFeedback(formData, user?.token || null);
      if (submitRes?.id) addMyFeedbackId(submitRes.id);

      if (submitAsGithubIdentity && submitRes?.ticket) {
        if (submitRes?.draft_url) {
          setTimeout(() => {
            window.open(submitRes.draft_url, '_blank', 'noopener,noreferrer');
          }, 700);
        }
        setConfirmTicket(submitRes.ticket);
        setConfirmStatus('pending');
        setConfirmError(null);
        return;
      }

      toast.success(t('feedback.submitSuccess'));
      onClose();
    } catch (err: any) {
      toast.error(err?.message || t('feedback.submitFail'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-gray-800">{t('feedback.title')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {confirmTicket !== null ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
              {confirmStatus === 'pending' && (
                <p className="text-sm text-blue-800">{t('feedback.confirmPrompt')}</p>
              )}
              {confirmStatus === 'confirming' && (
                <div className="flex items-center gap-2 text-sm text-blue-800">
                  <Loader2 size={16} className="animate-spin" />
                  {t('feedback.confirming')}
                </div>
              )}
              {confirmStatus === 'confirmed' && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold">
                  <CheckCircle2 size={16} />
                  {t('feedback.confirmSuccess')}
                </div>
              )}
              {confirmStatus === 'failed' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-red-700 font-semibold">
                    <XCircle size={16} />
                    {t('feedback.confirmFailed')}
                  </div>
                  {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50"
              >
                {t('feedback.confirmCancelButton')}
              </button>
              {confirmStatus !== 'confirmed' && (
                <button
                  onClick={handleConfirm}
                  disabled={confirmStatus === 'confirming'}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-black disabled:opacity-60 flex items-center gap-2"
                >
                  {confirmStatus === 'confirming' && <Loader2 size={14} className="animate-spin" />}
                  {t('feedback.confirmButton')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-0 mb-4 -mt-1 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-[1px] transition-colors ${activeTab === 'write' ? 'border-slate-800 text-slate-800' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                {t('feedback.tabWrite')}
              </button>
              {hasGithubBinding && (
                <button
                  type="button"
                  onClick={() => { setActiveTab('my-feedback'); }}
                  className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-[1px] transition-colors ${activeTab === 'my-feedback' ? 'border-slate-800 text-slate-800' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  {t('feedback.tabMyFeedback')}{myIssues.length > 0 ? ` (${myIssues.length})` : ''}
                </button>
              )}
            </div>

            {activeTab === 'write' ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2">{t('feedback.category')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategory('error')}
                className={`px-3 py-2 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 ${category === 'error' ? 'bg-red-50 border-red-300 text-red-600' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                <AlertTriangle size={16} /> {t('feedback.error')}
              </button>
              <button
                type="button"
                onClick={() => setCategory('suggestion')}
                className={`px-3 py-2 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 ${category === 'suggestion' ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                <Lightbulb size={16} /> {t('feedback.suggestion')}
              </button>
            </div>
          </div>

          {category === 'error' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-2">{t('feedback.errorModule')}</label>
              <select
                className="w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={errorModule}
                onChange={(e) => setErrorModule(e.target.value as ErrorModule)}
              >
                {ERROR_MODULE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {getErrorModuleLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2">{t('feedback.content')}</label>
            <textarea
              className="w-full border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              rows={6}
              maxLength={MAX_CONTENT_LENGTH}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleContentBlur}
              placeholder={t('feedback.placeholder')}
            />
            <div className="text-right text-xs text-gray-400 mt-1">{content.length}/{MAX_CONTENT_LENGTH}</div>
          </div>

          {(similarIssues.length > 0 || similarSearching) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 animate-slide-up">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-bold text-amber-700">{t('feedback.similarTitle')}</span>
                {similarSearching && <Loader2 size={11} className="animate-spin text-amber-500" />}
              </div>
              {similarIssues.length > 0 ? (
                <div className="space-y-1.5">
                  {similarIssues.slice(0, 4).map((issue: any) => (
                    <a
                      key={issue.number}
                      href={issue.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-amber-100/60 transition-colors group"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${issue.state === 'open' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      <span className="text-xs text-amber-800 flex-1 truncate group-hover:text-amber-900">{issue.title}</span>
                      <span className="text-[10px] text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">#{issue.number}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <Loader2 size={14} className="animate-spin text-amber-500 mx-auto" />
              )}
            </div>
          )}

          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-bold text-gray-500">{t('feedback.screenshot')}</div>
              <label className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                {t('feedback.upload')}
              </label>
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              {isProcessingImage ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
              {isProcessingImage ? t('feedback.processingImage') : screenshotHint}
            </div>
            {screenshot && (
              <button type="button" className="text-xs mt-2 text-red-500 hover:text-red-600" onClick={() => setScreenshot(null)}>
                {t('feedback.removeScreenshot')}
              </button>
            )}
          </div>

          {!submitAsGithubIdentity && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={includeIdentity}
                disabled={!user}
                onChange={(e) => setIncludeIdentity(e.target.checked)}
              />
              {t('feedback.includeIdentity')}
              {!user && <span className="text-xs text-gray-400">{t('feedback.loginRequired')}</span>}
            </label>
          )}

          <label className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={submitAsGithubIdentity}
                disabled={!hasGithubBinding}
                onChange={(e) => setSubmitAsGithubIdentity(e.target.checked)}
              />
              {t('feedback.submitAsGithubIdentity')}
            </span>
            <span className="text-xs text-gray-500">{t('feedback.submitAsGithubIdentityDesc')}</span>
            {!hasGithubBinding && (
              <span className="text-xs text-gray-400">{t('feedback.githubBindRequired')}</span>
            )}
          </label>

          <div className="text-right">
            <a
              href={GITHUB_ISSUES_LIST_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              {t('feedback.viewIssues')}
            </a>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isProcessingImage}
            className="w-full bg-slate-800 hover:bg-black text-white py-2.5 rounded-lg font-bold disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {t('feedback.submit')}
          </button>
        </form>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {myIssuesLoading ? (
                  <div className="flex items-center justify-center py-8 text-sm text-gray-400 gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {t('feedback.myIssuesLoading')}
                  </div>
                ) : myIssuesError ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-red-500 mb-2">{myIssuesError}</p>
                    <button onClick={fetchMyIssues} className="text-xs text-blue-600 hover:underline">{t('feedback.confirmButton')}</button>
                  </div>
                ) : myIssues.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">{t('feedback.myIssuesEmpty')}</p>
                ) : (
                  <div className="space-y-2">
                    {myIssues.map((item: any) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-lg border border-gray-200 bg-white space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-gray-700">
                            {item.category === 'error' ? t('feedback.error') : t('feedback.suggestion')}
                          </span>
                          <span className="text-[10px] text-gray-400">{new Date(item.created_at).toLocaleString()}</span>
                        </div>
                        <div className="text-sm text-gray-800 line-clamp-2">{item.content_preview}</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.hook?.issue_state && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              item.hook.issue_state === 'open' ? 'bg-emerald-100 text-emerald-700' :
                              item.hook.issue_state === 'closed' ? 'bg-gray-200 text-gray-700' :
                              item.hook.issue_state === 'deleted' ? 'bg-red-100 text-red-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {item.hook.issue_state}
                            </span>
                          )}
                          {item.hook?.issue_url && (
                            <a href={item.hook.issue_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">
                              #{item.hook.issue_number}
                            </a>
                          )}
                        </div>
                        {item.screenshot_url && (
                          <img src={item.screenshot_url} alt="screenshot" className="mt-1 max-h-24 rounded border" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
