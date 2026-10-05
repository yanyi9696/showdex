import * as React from 'react';

/**
 * Detects if the current viewport width is those of mobile devices.
 *
 * @since 1.0.5
 */
export const useMobileViewport = (
  threshold = 576,
): boolean => {
  const [mobile, setMobile] = React.useState(() => window.innerWidth <= threshold);

  React.useEffect(() => {
    const query = window.matchMedia(`(max-width: ${threshold}px)`);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [threshold]);

  return mobile;
};
