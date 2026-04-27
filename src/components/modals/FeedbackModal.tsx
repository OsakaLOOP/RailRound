import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Lightbulb, Loader2, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 2000;
const GITHUB_ISSUES_URL = 'https://github.com/OsakaLOOP/RailRound/issues/new/choose';
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
  const { isOpen, user, userProfile } = useStore(
    useShallow((state) => ({
      isOpen: state.modals.feedbackModalOpen,
      user: state.user,
      userProfile: state.userProfile
    }))
  );
  const setModalState = useStore((state) => state.setModalState);
  const { t, i18n } = useTranslation();

  const [category, setCategory] = useState<'error' | 'suggestion'>('error');
  const [errorModule, setErrorModule] = useState<ErrorModule>('routing');
  const [content, setContent] = useState('');
  const [includeIdentity, setIncludeIdentity] = useState(false);
  const [submitAsGithubIdentity, setSubmitAsGithubIdentity] = useState(false);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const getErrorModuleLabel = (module: ErrorModule) => {
    const key = `feedback.errorModuleOptions.${module}`;
    const translated = t(key);
    return translated === key ? ERROR_MODULE_LABEL_FALLBACK[module] : translated;
  };

  const onClose = () => setModalState({ feedbackModalOpen: false });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'feedback_github_confirmed') return;
      const issueUrl = String(event.data?.payload?.issue_url || '').trim();
      if (issueUrl) {
        toast.success(
          <a href={issueUrl} target="_blank" rel="noreferrer" className="underline">
            {t('feedback.callbackToastSuccess')}
          </a>
        );
      } else {
        toast.success(t('feedback.callbackToastSuccess'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [t]);

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

  useEffect(() => {
    if (!hasGithubBinding && submitAsGithubIdentity) {
      setSubmitAsGithubIdentity(false);
    }
  }, [hasGithubBinding, submitAsGithubIdentity]);

  const screenshotHint = useMemo(() => {
    if (!screenshot) return t('feedback.noScreenshot');
    return `${screenshot.name} (${(screenshot.size / 1024 / 1024).toFixed(2)} MB)`;
  }, [screenshot, t]);

  if (!isOpen) return null;

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
      formData.append('appVersion', (import.meta as any).env?.VITE_APP_VERSION || 'unknown');
      if (screenshot) {
        formData.append('screenshot', screenshot, screenshot.name);
      }

      const submitRes = await api.submitFeedback(formData, user?.token || null);
      if (submitAsGithubIdentity) {
        const callbackUrl = `${window.location.origin}/${(i18n.language || 'zh-CN').toLowerCase()}/feedback/github/callback?ticket=${encodeURIComponent(String(submitRes.ticket || ''))}`;
        if (submitRes?.ticket) {
          try {
            sessionStorage.setItem(
              'feedback_github_manual_context',
              JSON.stringify({
                feedback_id: submitRes.id || null,
                ticket: submitRes.ticket,
                callback_url: callbackUrl,
                created_at: new Date().toISOString()
              })
            );
          } catch {
            // ignore
          }
        }
        if (submitRes?.draft_url) {
          window.open(submitRes.draft_url, '_blank', 'noopener,noreferrer');
        }
        toast.success(t('feedback.githubManualJumpTip'));
        window.open(callbackUrl, '_blank', 'noopener,noreferrer');
        onClose();
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
              placeholder={t('feedback.placeholder')}
            />
            <div className="text-right text-xs text-gray-400 mt-1">{content.length}/{MAX_CONTENT_LENGTH}</div>
          </div>

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

          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
            <div className="text-xs font-bold text-blue-900 mb-1">{t('feedback.githubIssueTitle')}</div>
            <div className="text-xs text-blue-800 mb-2">{t('feedback.githubIssueDesc')}</div>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline"
            >
              {t('feedback.githubIssueLink')}
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
      </div>
    </div>
  );
};
