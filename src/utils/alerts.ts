import Swal from 'sweetalert2';
import i18next from 'i18next';

/**
 * 通用提示框 (Alert)
 * @param title 标题
 * @param text 内容
 * @param icon 图标类型
 */
export const showAlert = (title: string, text?: string, icon: 'success' | 'error' | 'warning' | 'info' | 'question' = 'info') => {
    return Swal.fire({
        title,
        text,
        icon,
        confirmButtonText: i18next.t('common.ok', '确定'),
        customClass: {
            confirmButton: 'rounded-xl px-8 py-2.5 bg-blue-600 text-white font-bold transition-all transform active:scale-95',
            popup: 'rounded-2xl mx-4',
        },
        buttonsStyling: false
    });
};

/**
 * 通用确认框 (Confirm)
 * @param title 标题
 * @param text 内容
 * @returns 是否点击了确定
 */
export const showConfirm = async (title: string, text?: string) => {
    const result = await Swal.fire({
        title,
        text,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: i18next.t('common.confirm', '确定'),
        cancelButtonText: i18next.t('common.cancel', '取消'),
        customClass: {
            confirmButton: 'rounded-xl px-8 py-2.5 bg-blue-600 text-white font-bold mr-3 transition-all transform active:scale-95',
            cancelButton: 'rounded-xl px-8 py-2.5 bg-gray-100 text-gray-700 font-bold transition-all transform active:scale-95',
            popup: 'rounded-2xl mx-4',
        },
        buttonsStyling: false
    });
    return result.isConfirmed;
};
