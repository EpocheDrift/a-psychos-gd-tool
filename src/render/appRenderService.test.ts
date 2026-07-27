import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../store';
import {
  appRenderCoordinator,
  startRenderStoreBinding,
  stopRenderStoreBinding,
} from './appRenderService';

afterEach(() => {
  stopRenderStoreBinding();
  vi.useRealTimers();
});

describe('synchronous render store binding', () => {
  it('schedules document/font changes but ignores selection-only state', () => {
    vi.useFakeTimers();
    const initial = useApp.getState();
    startRenderStoreBinding();
    const first = appRenderCoordinator.getRenderStatus().ticket;
    expect(first).toMatchObject({ revision: initial.revision });

    useApp.setState({ selectedNodeIds: ['selection-only'] });
    expect(appRenderCoordinator.getRenderStatus().ticket).toEqual(first);

    const nextDocument = {
      ...initial.doc,
      frame: {
        ...initial.doc.frame,
        width: initial.doc.frame.width === 4096
          ? 4095
          : initial.doc.frame.width + 1,
      },
    };
    useApp.setState({
      doc: nextDocument,
      revision: initial.revision + 1,
    });
    const documentTicket = appRenderCoordinator.getRenderStatus().ticket;
    expect(documentTicket).toMatchObject({
      revision: initial.revision + 1,
      attempt: 1,
    });

    useApp.setState({
      fonts: {
        ...initial.fonts,
        test: {} as never,
      },
    });
    const fontTicket = appRenderCoordinator.getRenderStatus().ticket;
    expect(fontTicket).toMatchObject({
      revision: initial.revision + 1,
      attempt: 2,
    });

    stopRenderStoreBinding();
    useApp.setState({
      doc: initial.doc,
      // Coordinator revisions are monotonic for the lifetime of this module.
      revision: initial.revision + 1,
      fonts: initial.fonts,
      selectedNodeIds: initial.selectedNodeIds,
    });
  });

  it('is idempotent when started twice', () => {
    vi.useFakeTimers();
    startRenderStoreBinding();
    const first = appRenderCoordinator.getRenderStatus().ticket;
    startRenderStoreBinding();
    expect(appRenderCoordinator.getRenderStatus().ticket).toEqual(first);
  });
});
