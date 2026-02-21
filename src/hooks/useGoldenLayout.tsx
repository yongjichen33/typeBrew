import { useRef, useCallback, useEffect, useState } from 'react';
import {
  GoldenLayout,
  ComponentContainer,
  type LayoutConfig,
  type JsonValue,
} from 'golden-layout';
import { createRoot, type Root } from 'react-dom/client';
import { TableContentTab } from '@/components/TableContentTab';
import { GlyphEditorTab } from '@/components/editor/GlyphEditorTab';
import type { GlyphEditorTabState } from '@/lib/editorTypes';

function tabKey(filePath: string, tableName: string): string {
  return `${filePath}::${tableName}`;
}

function editorTabKey(filePath: string, glyphId: number): string {
  return `${filePath}::glyph::${glyphId}`;
}

interface TableTabState {
  filePath: string;
  tableName: string;
}

export function useGoldenLayout() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const layoutRef = useRef<GoldenLayout | null>(null);
  const reactRootsRef = useRef<Map<string, Root>>(new Map());
  const openTabsRef = useRef<Map<string, ComponentContainer>>(new Map());
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    if (!container) return;

    const layout = new GoldenLayout(container);

    // ---- TableContentTab component ----
    layout.registerComponentFactoryFunction(
      'TableContentTab',
      (glContainer: ComponentContainer, state: JsonValue | undefined) => {
        const tabState = state as unknown as TableTabState;
        const key = tabKey(tabState.filePath, tabState.tableName);

        const root = createRoot(glContainer.element);
        reactRootsRef.current.set(key, root);
        openTabsRef.current.set(key, glContainer);

        root.render(
          <TableContentTab
            filePath={tabState.filePath}
            tableName={tabState.tableName}
          />,
        );

        setIsEmpty(false);

        glContainer.addEventListener('beforeComponentRelease', () => {
          const r = reactRootsRef.current.get(key);
          if (r) { r.unmount(); reactRootsRef.current.delete(key); }
          openTabsRef.current.delete(key);
        });

        return undefined;
      },
    );

    // ---- GlyphEditorTab component ----
    layout.registerComponentFactoryFunction(
      'GlyphEditorTab',
      (glContainer: ComponentContainer, state: JsonValue | undefined) => {
        const tabState = state as unknown as GlyphEditorTabState;
        const key = editorTabKey(tabState.filePath, tabState.glyphId);

        const root = createRoot(glContainer.element);
        reactRootsRef.current.set(key, root);
        openTabsRef.current.set(key, glContainer);

        root.render(<GlyphEditorTab tabState={tabState} />);

        setIsEmpty(false);

        glContainer.addEventListener('beforeComponentRelease', () => {
          const r = reactRootsRef.current.get(key);
          if (r) { r.unmount(); reactRootsRef.current.delete(key); }
          openTabsRef.current.delete(key);
        });

        return undefined;
      },
    );

    layout.on('itemDestroyed', () => {
      requestAnimationFrame(() => {
        if (layoutRef.current) {
          const rootItem = layoutRef.current.rootItem;
          const hasContent = rootItem && rootItem.contentItems.length > 0;
          setIsEmpty(!hasContent);
        }
      });
    });

    const initialConfig: LayoutConfig = {
      dimensions: {
        borderWidth: 1,
        borderGrabWidth: 8,
      },
      root: {
        type: 'stack',
        content: [],
      },
    };
    layout.loadLayout(initialConfig);
    layoutRef.current = layout;

    const resizeObserver = new ResizeObserver(() => {
      if (layoutRef.current && container.offsetWidth > 0 && container.offsetHeight > 0) {
        layoutRef.current.setSize(container.offsetWidth, container.offsetHeight);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      for (const root of reactRootsRef.current.values()) {
        root.unmount();
      }
      reactRootsRef.current.clear();
      openTabsRef.current.clear();
      layout.destroy();
      layoutRef.current = null;
    };
  }, [container]);

  const addTab = useCallback((filePath: string, tableName: string, title: string) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const key = tabKey(filePath, tableName);
    const existingContainer = openTabsRef.current.get(key);
    if (existingContainer) {
      existingContainer.focus();
      return;
    }

    const componentState: TableTabState = { filePath, tableName };
    try {
      layout.addComponent('TableContentTab', componentState as unknown as JsonValue, title);
    } catch (e) {
      console.error('Failed to add golden-layout tab:', e);
    }
  }, []);

  const addEditorTab = useCallback((tabState: GlyphEditorTabState) => {
    const layout = layoutRef.current;
    if (!layout) return;

    const key = editorTabKey(tabState.filePath, tabState.glyphId);
    const existingContainer = openTabsRef.current.get(key);
    if (existingContainer) {
      existingContainer.focus();
      return;
    }

    const title = tabState.glyphName
      ? `${tabState.glyphName} #${tabState.glyphId}`
      : `glyph #${tabState.glyphId}`;

    try {
      layout.addComponent('GlyphEditorTab', tabState as unknown as JsonValue, title);
    } catch (e) {
      console.error('Failed to add glyph editor tab:', e);
    }
  }, []);

  return { containerRef: setContainer, addTab, addEditorTab, isEmpty };
}
