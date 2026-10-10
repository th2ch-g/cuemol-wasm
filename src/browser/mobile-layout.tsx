import React, { useEffect, useState } from 'react';
import { useSceneTreeState, useSceneTreeActions } from '@renderer/state/sceneTree';

export const COMPACT_QUERY = '(max-width: 760px), (max-width: 1100px) and (pointer: coarse)';
type Panel = 'model' | 'tools' | 'properties' | 'console';

export function useMobileLayout() {
  const [compact, setCompact] = useState(() => matchMedia(COMPACT_QUERY).matches);
  const [panel, setPanel] = useState<Panel>('model');
  useEffect(() => {
    const query = matchMedia(COMPACT_QUERY);
    const update = () => { setCompact(query.matches); setPanel('model'); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return { compact, panel, setPanel };
}

export function MobilePanelBar({ layout, hasTarget }: {
  layout: ReturnType<typeof useMobileLayout>; hasTarget: boolean;
}) {
  const { selectedId, selectedHasOps } = useSceneTreeState();
  const { showProperty } = useSceneTreeActions();
  if (!layout.compact) return null;
  return <div className="mobile-panel-bar">
    <nav aria-label="Workspace panels">
      {(['model', 'tools', 'properties', 'console'] as const).map(panel =>
        <button key={panel} type="button" aria-pressed={layout.panel === panel}
          disabled={panel === 'properties' && !hasTarget && (!selectedId || selectedHasOps?.property === false)}
          onClick={() => {
            if (panel === 'properties' && selectedId && (layout.panel === 'tools' || !hasTarget)) showProperty(selectedId);
            layout.setPanel(panel);
          }}>
          {{ model: 'Model', tools: 'Tools', properties: 'Properties', console: 'Panels' }[panel]}
        </button>)}
    </nav>
    {layout.panel === 'model' && <div className="mobile-gesture-hint">
      One finger: rotate · Two fingers: move / zoom
    </div>}
  </div>;
}
