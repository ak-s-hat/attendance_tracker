import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BoundingBox } from '../ai/types';

export interface FaceOverlayProps {
  bbox?: BoundingBox;
  status: 'idle' | 'scanning' | 'success' | 'spoof' | 'unknown' | 'error';
  containerWidth: number;
  containerHeight: number;
  frameWidth?: number;
  frameHeight?: number;
  detScore?: number;
  isFrontFacing?: boolean;
}

export const FaceOverlay: React.FC<FaceOverlayProps> = ({
  bbox,
  status,
  containerWidth,
  containerHeight,
  frameWidth,
  frameHeight,
  detScore,
  isFrontFacing = true,
}) => {
  if (!bbox || containerWidth <= 0 || containerHeight <= 0) return null;

  const [x1, y1, x2, y2] = bbox;

  // If frame dimensions are not provided or 0, fallback to standard portrait 720x1280 or 640x480
  const fw = frameWidth && frameWidth > 0 ? frameWidth : (x2 > 640 || y2 > 640 ? 1080 : 640);
  const fh = frameHeight && frameHeight > 0 ? frameHeight : (y2 > 640 ? 1920 : 480);

  // Aspect-fill / Cover scale calculation matching CameraView's fill mode
  const scale = Math.max(containerWidth / fw, containerHeight / fh);
  const offsetX = (containerWidth - fw * scale) / 2;
  const offsetY = (containerHeight - fh * scale) / 2;

  const boxW = Math.max(20, (x2 - x1) * scale);
  const boxH = Math.max(20, (y2 - y1) * scale);
  const top = Math.max(0, y1 * scale + offsetY);
  
  // Mirror for front camera
  const left = isFrontFacing
    ? Math.max(0, containerWidth - (x2 * scale + offsetX))
    : Math.max(0, x1 * scale + offsetX);

  const getBorderColor = () => {
    switch (status) {
      case 'success':
        return '#00FF88';
      case 'spoof':
        return '#FF3B30';
      case 'unknown':
        return '#FF9500';
      case 'scanning':
      default:
        return '#FFCC00';
    }
  };

  const borderColor = getBorderColor();

  return (
    <View testID="face-overlay" style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View
        testID="bbox-rect"
        style={[
          styles.box,
          {
            left,
            top,
            width: boxW,
            height: boxH,
            borderColor,
          },
        ]}
      >
        <View testID="bbox-tag" style={[styles.tag, { backgroundColor: borderColor }]}>
          <Text style={styles.tagText}>
            {detScore ? `Face (${(detScore * 100).toFixed(0)}%)` : 'Face Detected'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2.5,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 255, 136, 0.05)',
  },
  tag: {
    position: 'absolute',
    top: -24,
    left: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
