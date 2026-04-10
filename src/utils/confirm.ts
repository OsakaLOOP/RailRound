import Swal, { SweetAlertOptions } from 'sweetalert2';
import i18n from '../i18n';

export const showConfirm = async (options: SweetAlertOptions | string) => {
    const defaultOptions: SweetAlertOptions = {
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: i18n.t('confirm.yes', '确定'),
        cancelButtonText: i18n.t('confirm.no', '取消'),
    };

    const finalOptions = typeof options === 'string'
        ? { ...defaultOptions, title: options }
        : { ...defaultOptions, ...options };

    const result = await Swal.fire(finalOptions);
    return result.isConfirmed;
};

export const showAlert = async (options: SweetAlertOptions | string) => {
    const defaultOptions: SweetAlertOptions = {
        icon: 'info',
        confirmButtonText: i18n.t('confirm.ok', '好的'),
        confirmButtonColor: '#3085d6',
    };

    const finalOptions = typeof options === 'string'
        ? { ...defaultOptions, title: options }
        : { ...defaultOptions, ...options };

    await Swal.fire(finalOptions);
};
