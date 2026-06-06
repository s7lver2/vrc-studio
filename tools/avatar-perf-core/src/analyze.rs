use crate::types::AvatarMetrics;
use crate::unity_yaml::UnityDocument;
pub fn count_metrics(_docs: &[UnityDocument], _avatar_name: &str, _project_path: &str) -> AvatarMetrics { Default::default() }
