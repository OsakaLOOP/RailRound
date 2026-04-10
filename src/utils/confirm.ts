import Swal, { SweetAlertOptions } from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { i18n } from 'i18next';

const MySwal = withReactContent(Swal);

// Utility function to show a confirm dialog
export const showConfirm = async (
    title: string,
    text: string = '',
    t: any = (key: string, fallback: string) => fallback
): Promise<boolean> => {
    const result = await MySwal.fire({
        title: title,
        text: text,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#10b981', // emerald-500
        cancelButtonColor: '#ef4444', // red-500
        confirmButtonText: t('common.confirm', '确认'),
        cancelButtonText: t('common.cancel', '取消'),
        reverseButtons: true, // Typically better UX to have confirm on the right
    });

    return result.isConfirmed;
};

export default showConfirm;
