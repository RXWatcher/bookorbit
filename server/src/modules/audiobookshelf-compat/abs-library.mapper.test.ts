import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { mapAbsLibrary } from './abs-library.mapper';

describe('abs-library.mapper', () => {
  it('maps local libraries with encoded IDs', () => {
    expect(
      mapAbsLibrary({
        id: 7,
        name: 'Books',
        coverAspectRatio: '2/3',
      } as never),
    ).toEqual({
      id: 'lib_l_7',
      name: 'Books',
      mediaType: 'book',
      settings: {
        coverAspectRatio: '2/3',
      },
    });
  });

  it('maps warehouse audiobook sentinel libraries without negative client IDs', () => {
    expect(
      mapAbsLibrary({
        id: CLOUD_AUDIO_LIBRARY_ID,
        name: 'Audiobooks',
        coverAspectRatio: '2/3',
        sourceKind: 'source_backed',
      } as never),
    ).toEqual({
      id: 'lib_bw_audio',
      name: 'Audiobooks',
      mediaType: 'audiobook',
      settings: {
        coverAspectRatio: '2/3',
      },
    });
  });

  it('does not serialize provider or source-backed implementation details', () => {
    const mapped = mapAbsLibrary({
      id: CLOUD_AUDIO_LIBRARY_ID,
      name: 'Audiobooks',
      coverAspectRatio: '1/1',
      sourceKind: 'source_backed',
      provider: 'warehouse',
    } as never);
    const json = JSON.stringify(mapped);

    expect(mapped).not.toHaveProperty('provider');
    expect(mapped.settings).not.toHaveProperty('sourceKind');
    expect(json).not.toContain('source_backed');
    expect(json).not.toContain('warehouse');
  });
});
