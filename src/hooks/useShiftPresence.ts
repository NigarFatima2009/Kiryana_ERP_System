import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Global Shift Active Tracker
 * Continuously tracks active cashier time across all internal web app pages (POS, Products, Sales, etc.)
 */
export function useGlobalShiftTracker() {
  useEffect(() => {
    let lastActivity = Date.now();

    const handleUserActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('scroll', handleUserActivity);

    const interval = setInterval(async () => {
      // Pause if tab is hidden or user was idle for > 5 minutes
      if (document.visibilityState === 'hidden' || Date.now() - lastActivity > 300000) {
        return;
      }

      try {
        const storedShiftStr = localStorage.getItem('current_cashier_shift');
        if (!storedShiftStr) return;
        const shift = JSON.parse(storedShiftStr);
        if (!shift?.id || shift.status !== 'OPEN') return;

        const storageKey = `shift_active_seconds_${shift.id}`;
        const current = parseInt(localStorage.getItem(storageKey) || '0', 10);
        const updated = current + 1;
        localStorage.setItem(storageKey, updated.toString());

        window.dispatchEvent(new CustomEvent('shift-presence-updated', {
          detail: { shiftId: shift.id, activeSeconds: updated }
        }));
      } catch (e) {
        // non-critical
      }
    }, 1000);

    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
      clearInterval(interval);
    };
  }, []);
}
