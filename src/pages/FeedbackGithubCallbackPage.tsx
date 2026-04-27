import React from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { useStore } from '../store';
import { buildAppPath, normalizeAppLang } from '../utils/routes';

type ConfirmState = 'loading' | 'success' | 'failed';

export const FeedbackGithubCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useParams();
  const { t } = useTranslation();
  const user = useStore((state) => state.user);

  const [state, setState] = React.useState<ConfirmState>('loading');
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [issueUrl, setIssueUrl] = React.useState<string | null>(null);
  const [issueNumber, setIssueNumber] = React.useState<number | null>(null);

  React.useEffect(() => {
    const ticket = String(searchParams.get('ticket') || '').trim();
    if (!ticket) {
      setState('failed');
      setErrorText(t('feedback.callbackMissingTicket'));
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const res = await api.confirmFeedbackIssue(ticket, user?.token || null);
        const hook = res?.hook || {};
        if (cancelled) return;
        if (hook?.status === 'success' && (hook?.issue_state === 'open' || hook?.issue_state === 'closed' || hook?.issue_state === 'deleted')) {
          setIssueUrl(hook?.issue_url || null);
          setIssueNumber(Number.isFinite(Number(hook?.issue_number)) ? Number(hook.issue_number) : null);
          setState('success');
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage({
                type: 'feedback_github_confirmed',
                payload: {
                  issue_url: hook?.issue_url || null,
                  issue_number: hook?.issue_number || null,
                  issue_state: hook?.issue_state || null,
                  status: hook?.status || null
                }
              }, window.location.origin);
            }
          } catch {
            // ignore cross-window message failure
          }
          return;
        }

        setState('failed');
        setErrorText(hook?.error || t('feedback.callbackConfirmFailed'));
      } catch (err: any) {
        if (cancelled) return;
        setState('failed');
        setErrorText(err?.message || t('feedback.callbackConfirmFailed'));
      }
    };

    run().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [searchParams, t, user?.token]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6">
        <h1 className="text-lg font-bold text-gray-800 mb-4">{t('feedback.callbackTitle')}</h1>

        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 size={16} className="animate-spin" />
            {t('feedback.callbackChecking')}
          </div>
        )}

        {state === 'success' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
              <CheckCircle2 size={16} />
              {t('feedback.callbackSuccess')}
            </div>
            {issueNumber ? <div className="text-sm text-gray-700">#{issueNumber}</div> : null}
            {issueUrl ? (
              <a href={issueUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                {t('feedback.callbackOpenIssue')}
              </a>
            ) : null}
          </div>
        )}

        {state === 'failed' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
              <XCircle size={16} />
              {t('feedback.callbackFailed')}
            </div>
            <div className="text-sm text-red-600 break-all">{errorText || '-'}</div>
            <div className="text-xs text-gray-500">{t('feedback.callbackRetryHint')}</div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => navigate(buildAppPath(normalizeAppLang(lang), 'stats'))}
            className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
          >
            {t('feedback.callbackBackApp')}
          </button>
          <button
            onClick={() => window.close()}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-black"
          >
            {t('feedback.callbackClose')}
          </button>
        </div>
      </div>
    </div>
  );
};
