import * as React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  children: React.ReactNode;
}

/**
 * 为博客组件提供一致的错误边界包裹
 */
export const BlogErrorWrapper: React.FC<Props> = ({ children }) => {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
};
