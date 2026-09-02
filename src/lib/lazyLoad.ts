import React, { lazy, Suspense, ComponentType } from 'react';

/**
 * Wrapper for lazy loading components with a fallback UI
 * Automatically adds Suspense boundary with loading spinner
 */
export function lazyLoad(
  importFunc: () => Promise<{ default: ComponentType<any> } | any>
): ComponentType<any> {
  const LazyComponent = lazy(importFunc as any);

  return function LazyWithFallback(props: any) {
    const fallback = React.createElement(
      'div',
      { className: 'flex items-center justify-center min-h-screen' },
      React.createElement(
        'div',
        { className: 'text-center' },
        React.createElement('div', {
          className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4',
        }),
        React.createElement('p', { className: 'text-gray-600' }, 'Loading...')
      )
    );

    return React.createElement(
      Suspense,
      { fallback },
      React.createElement(LazyComponent, props)
    );
  };
}

/**
 * Wrapper for lazy loading modal components
 * Uses lightweight loading indicator suitable for modals
 */
export function lazyLoadModal(
  importFunc: () => Promise<{ default: ComponentType<any> } | any>
): ComponentType<any> {
  const LazyComponent = lazy(importFunc as any);

  return function LazyModalWithFallback(props: any) {
    const fallback = React.createElement(
      'div',
      { className: 'flex items-center justify-center py-8' },
      React.createElement('div', {
        className: 'animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600',
      })
    );

    return React.createElement(
      Suspense,
      { fallback },
      React.createElement(LazyComponent, props)
    );
  };
}
