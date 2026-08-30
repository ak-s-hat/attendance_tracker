import React from 'react';
import renderer from 'react-test-renderer';
import { FaceOverlay } from '../../src/components/FaceOverlay';
import { BoundingBox } from '../../src/ai/types';

describe('FaceOverlay Component Unit Tests', () => {
  const mockBbox: BoundingBox = [100, 100, 300, 300];

  it('renders bounding box rectangle matching scaled coordinates', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <FaceOverlay
          bbox={mockBbox}
          status="scanning"
          containerWidth={320}
          containerHeight={480}
          frameWidth={640}
          frameHeight={480}
        />
      );
    });

    const root = tree.root;
    const rect = root.findByProps({ testID: 'bbox-rect' });
    expect(rect.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          left: 50,
          top: 100,
          width: 100,
          height: 200,
        }),
      ])
    );
  });

  it('renders bounding box coordinate label string BBox: [x1, y1, x2, y2]', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <FaceOverlay
          bbox={mockBbox}
          status="scanning"
          containerWidth={360}
          containerHeight={480}
        />
      );
    });

    const root = tree.root;
    const tag = root.findByProps({ testID: 'bbox-tag' });
    const tagText = tag.findByType('Text');
    expect(tagText.props.children).toEqual([
      'BBox: [',
      100,
      ', ',
      100,
      ', ',
      300,
      ', ',
      300,
      ']',
    ]);
  });

  it('applies green border #00FF88 on status success', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <FaceOverlay
          bbox={mockBbox}
          status="success"
          containerWidth={360}
          containerHeight={480}
        />
      );
    });

    const root = tree.root;
    const rect = root.findByProps({ testID: 'bbox-rect' });
    expect(rect.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: '#00FF88',
        }),
      ])
    );
  });

  it('applies red border #FF3B30 on status spoof', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <FaceOverlay
          bbox={mockBbox}
          status="spoof"
          containerWidth={360}
          containerHeight={480}
        />
      );
    });

    const root = tree.root;
    const rect = root.findByProps({ testID: 'bbox-rect' });
    expect(rect.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderColor: '#FF3B30',
        }),
      ])
    );
  });

  it('returns null when bbox is undefined', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <FaceOverlay
          bbox={undefined}
          status="scanning"
          containerWidth={360}
          containerHeight={480}
        />
      );
    });

    expect(tree.toJSON()).toBeNull();
  });
});
