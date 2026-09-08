import pipelineSpec from './pipeline_spec.json';

export const PIPELINE_CONFIG = {
  version: pipelineSpec.version,
  runtime: pipelineSpec.runtime_environment,
  quantization: pipelineSpec.quantization_profile,
  detector: {
    name: pipelineSpec.models.detection.name,
    inputShape: pipelineSpec.models.detection.input_tensor.shape as [number, number, number, number],
    threshold: pipelineSpec.models.detection.tunable_parameters.detection_threshold.default,
    nmsThreshold: pipelineSpec.models.detection.tunable_parameters.nms_iou_threshold.default,
  },
  liveness: {
    name: pipelineSpec.models.liveness.name,
    inputShape: pipelineSpec.models.liveness.input_tensor.shape as [number, number, number, number],
    bboxExpansionRatio: pipelineSpec.models.liveness.tunable_parameters.bbox_expansion_ratio.default,
    threshold: pipelineSpec.models.liveness.tunable_parameters.liveness_threshold.default,
  },
  recognizer: {
    name: pipelineSpec.models.recognition.name,
    inputShape: pipelineSpec.models.recognition.input_tensor.shape as [number, number, number, number],
    dimensions: pipelineSpec.models.recognition.tunable_parameters.embedding_dimensions,
    cosineThreshold: pipelineSpec.models.recognition.tunable_parameters.cosine_similarity_threshold.default,
  },
  performanceBudgets: pipelineSpec.target_performance_budgets,
} as const;

export default PIPELINE_CONFIG;
