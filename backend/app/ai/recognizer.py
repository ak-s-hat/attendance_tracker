"""Face recognizer — extracts and normalizes ArcFace embeddings."""

import numpy as np


class FaceRecognizer:
    """
    Wraps embedding extraction from an InsightFace Face object.

    InsightFace buffalo_l bundles both SCRFD (detector) and ArcFace (recognizer).
    FaceAnalysis.get() already computes face.embedding internally, so this
    class simply normalizes and exposes it.
    """

    def get_embedding(self, face_object) -> np.ndarray:
        """
        Extract a normalized 512-d ArcFace embedding from an InsightFace Face.

        Args:
            face_object: the Face object returned by FaceDetector.detect()

        Returns:
            L2-normalized numpy array of shape (512,)
        """
        embedding = face_object.embedding  # raw 512-d vector
        norm = np.linalg.norm(embedding)
        if norm == 0:
            raise ValueError("Face embedding has zero norm — corrupt model output")
        normalized = embedding / norm
        return normalized

    @staticmethod
    def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """
        Cosine similarity between two L2-normalized vectors.

        Since both are unit vectors, dot product = cosine similarity.

        Returns:
            float between -1.0 and 1.0
        """
        return float(np.dot(vec_a, vec_b))
