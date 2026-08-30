import { CachedEmployee } from '../database/offlineDb';

export interface MatchResult {
  employee: CachedEmployee;
  similarity: number; // 0.0 to 1.0 (1.0 = identical)
}

export class InMemVectorGallery {
  private employees: CachedEmployee[] = [];
  private flatVectors: Float32Array = new Float32Array(0);
  private count: number = 0;
  private readonly dim: number = 512;

  /**
   * Initializes or updates the in-memory contiguous vector matrix
   */
  public loadGallery(employees: CachedEmployee[]): void {
    // Filter employees who have valid 512-d embeddings
    const valid = employees.filter((e) => e.embedding && e.embedding.length === this.dim);
    this.employees = valid;
    this.count = valid.length;
    this.flatVectors = new Float32Array(this.count * this.dim);

    for (let i = 0; i < this.count; i++) {
      const vec = valid[i].embedding;
      let norm = 0;
      for (let d = 0; d < this.dim; d++) {
        norm += vec[d] * vec[d];
      }
      norm = Math.sqrt(norm) || 1.0;

      // Store normalized vector
      const offset = i * this.dim;
      for (let d = 0; d < this.dim; d++) {
        this.flatVectors[offset + d] = vec[d] / norm;
      }
    }
  }

  /**
   * Fast vectorized dot-product search across all cached employees (< 1ms for 500 emps)
   */
  public searchBestMatch(
    queryVector: number[] | Float32Array,
    threshold: number = 0.65
  ): MatchResult | null {
    if (this.count === 0 || queryVector.length !== this.dim) {
      return null;
    }

    // Normalize query vector
    let qNorm = 0;
    for (let d = 0; d < this.dim; d++) {
      qNorm += queryVector[d] * queryVector[d];
    }
    qNorm = Math.sqrt(qNorm) || 1.0;

    const normQ = new Float32Array(this.dim);
    for (let d = 0; d < this.dim; d++) {
      normQ[d] = queryVector[d] / qNorm;
    }

    let bestScore = -1.0;
    let bestIndex = -1;

    // Vectorized linear scan across contiguous Float32Array
    for (let i = 0; i < this.count; i++) {
      const offset = i * this.dim;
      let dot = 0.0;

      // Unroll loop for SIMD optimization on mobile CPU
      for (let d = 0; d < this.dim; d += 4) {
        dot +=
          this.flatVectors[offset + d] * normQ[d] +
          this.flatVectors[offset + d + 1] * normQ[d + 1] +
          this.flatVectors[offset + d + 2] * normQ[d + 2] +
          this.flatVectors[offset + d + 3] * normQ[d + 3];
      }

      if (dot > bestScore) {
        bestScore = dot;
        bestIndex = i;
      }
    }

    if (bestScore >= threshold && bestIndex >= 0) {
      return {
        employee: this.employees[bestIndex],
        similarity: Math.round(bestScore * 1000) / 1000,
      };
    }

    return null;
  }

  public getGallerySize(): number {
    return this.count;
  }
}

export const vectorGallery = new InMemVectorGallery();
