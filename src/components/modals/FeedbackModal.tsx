import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Lightbulb, Loader2, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 2000;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('图片处理失败'));
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
            reject(new Error('无法读取图片'));
        };
        img.src = url;
    });

async function compressImageToLimit(file: File, maxBytes = MAX_IMAGE_BYTES): Promise<File> {
    if (!file.type.startsWith('image/')) {
        throw new Error('仅支持图片文件');
    }
    if (file.size <= maxBytes) {
        return file;
    }

    const img = await loadImageElement(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持图片压缩');

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

    throw new Error('图片压缩后仍超过 2MB，请换一张截图');
}

export const FeedbackModal: React.FC = () => {
    const { isOpen, user } = useStore(useShallow((state) => ({
        isOpen: state.modals.feedbackModalOpen,
        user: state.user
    })));
    const setModalState = useStore((state) => state.setModalState);
    const { t } = useTranslation();

    const [category, setCategory] = useState<'error' | 'suggestion'>('error');
    const [content, setContent] = useState('');
    const [includeIdentity, setIncludeIdentity] = useState(false);
    const [screenshot, setScreenshot] = useState<File | null>(null);
    const [isProcessingImage, setIsProcessingImage] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const onClose = () => setModalState({ feedbackModalOpen: false });

    useEffect(() => {
        if (!isOpen) {
            setCategory('error');
            setContent('');
            setIncludeIdentity(false);
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

    const screenshotHint = useMemo(() => {
        if (!screenshot) return t('feedback.noScreenshot', '未上传截图');
        return `${screenshot.name} (${(screenshot.size / 1024 / 1024).toFixed(2)} MB)`;
    }, [screenshot, t]);

    if (!isOpen) return null;

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('feedback.imageTypeError', '请上传图片文件'));
            e.target.value = '';
            return;
        }

        setIsProcessingImage(true);
        try {
            const compressed = await compressImageToLimit(file, MAX_IMAGE_BYTES);
            setScreenshot(compressed);
            toast.success(t('feedback.imageReady', '截图已处理'));
        } catch (err: any) {
            toast.error(err?.message || t('feedback.imageCompressError', '截图处理失败'));
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
            toast.error(t('feedback.contentRequired', '请填写反馈内容'));
            return;
        }
        if (trimmed.length > MAX_CONTENT_LENGTH) {
            toast.error(t('feedback.contentTooLong', '反馈内容过长'));
            return;
        }
        if (isProcessingImage || isSubmitting) return;

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('category', category);
            formData.append('content', trimmed);
            formData.append('includeIdentity', includeIdentity ? 'true' : 'false');
            formData.append('lang', navigator.language || '');
            formData.append('path', `${window.location.pathname}${window.location.search}`);
            formData.append('appVersion', (import.meta as any).env?.VITE_APP_VERSION || 'unknown');
            if (screenshot) {
                formData.append('screenshot', screenshot, screenshot.name);
            }

            await api.submitFeedback(formData, user?.token || null);
            toast.success(t('feedback.submitSuccess', '反馈提交成功，感谢你的帮助'));
            onClose();
        } catch (err: any) {
            toast.error(err?.message || t('feedback.submitFail', '反馈提交失败'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-gray-800">{t('feedback.title', '反馈')}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={18} />
                    </button>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2">{t('feedback.category', '分类')}</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setCategory('error')}
                                className={`px-3 py-2 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 ${category === 'error' ? 'bg-red-50 border-red-300 text-red-600' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
                            >
                                <AlertTriangle size={16} /> {t('feedback.error', '报错')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCategory('suggestion')}
                                className={`px-3 py-2 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 ${category === 'suggestion' ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
                            >
                                <Lightbulb size={16} /> {t('feedback.suggestion', '建议')}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2">{t('feedback.content', '内容')}</label>
                        <textarea
                            className="w-full border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            rows={6}
                            maxLength={MAX_CONTENT_LENGTH}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={t('feedback.placeholder', '请描述你遇到的问题，或你希望新增/优化的内容')}
                        />
                        <div className="text-right text-xs text-gray-400 mt-1">{content.length}/{MAX_CONTENT_LENGTH}</div>
                    </div>

                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="text-xs font-bold text-gray-500">{t('feedback.screenshot', '截图（可选）')}</div>
                            <label className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 cursor-pointer">
                                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                                {t('feedback.upload', '选择图片')}
                            </label>
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                            {isProcessingImage ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                            {isProcessingImage ? t('feedback.processingImage', '正在压缩图片...') : screenshotHint}
                        </div>
                        {screenshot && (
                            <button
                                type="button"
                                className="text-xs mt-2 text-red-500 hover:text-red-600"
                                onClick={() => setScreenshot(null)}
                            >
                                {t('feedback.removeScreenshot', '移除截图')}
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
                        {t('feedback.includeIdentity', '提交时附带我的用户名')}
                        {!user && <span className="text-xs text-gray-400">{t('feedback.loginRequired', '(登录后可选)')}</span>}
                    </label>

                    <button
                        type="submit"
                        disabled={isSubmitting || isProcessingImage}
                        className="w-full bg-slate-800 hover:bg-black text-white py-2.5 rounded-lg font-bold disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                        {t('feedback.submit', '提交反馈')}
                    </button>
                </form>
            </div>
        </div>
    );
};
