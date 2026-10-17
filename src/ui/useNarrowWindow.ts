import { useEffect, useState } from 'react';

/** At this width or narrower, the review shows two columns whatever the view setting (FR-25c). */
const NARROW_QUERY = '(max-width: 1024px)';

function isNarrow(): boolean {
  return typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;
}

/** Whether the window is too narrow for three columns, following resizes. */
export function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
