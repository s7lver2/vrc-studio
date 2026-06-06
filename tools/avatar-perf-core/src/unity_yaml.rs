// tools/avatar-perf-core/src/unity_yaml.rs
use regex::Regex;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct UnityDocument {
    pub class_id: u32,
    pub file_id: u64,
    pub raw: String,
}

impl UnityDocument {
    pub fn get_field(&self, key: &str) -> Option<String> {
        let pattern = format!(r"(?m)^\s*{}:\s*(.+)$", regex::escape(key));
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
    }

    pub fn get_guid_field(&self, field_name: &str) -> Option<String> {
        let pattern = format!(
            r"{}:\s*\{{[^}}]*guid:\s*([a-fA-F0-9]+)",
            regex::escape(field_name)
        );
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    }

    pub fn get_file_id_field(&self, field_name: &str) -> Option<u64> {
        let pattern = format!(
            r"{}:\s*\{{fileID:\s*(\d+)",
            regex::escape(field_name)
        );
        let re = Regex::new(&pattern).ok()?;
        re.captures(&self.raw)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
    }

    pub fn get_component_file_ids(&self) -> Vec<u64> {
        let re = Regex::new(r"component:\s*\{fileID:\s*(\d+)").unwrap();
        re.captures_iter(&self.raw)
            .filter_map(|c| c.get(1)?.as_str().parse().ok())
            .collect()
    }

    pub fn get_list_file_ids(&self, field_name: &str) -> Vec<u64> {
        let start_pattern = format!(r"{}:", regex::escape(field_name));
        if let Some(start) = self.raw.find(&start_pattern) {
            let block = &self.raw[start..];
            let re = Regex::new(r"fileID:\s*(\d+)").unwrap();
            return re.captures_iter(block)
                .take(64)
                .filter_map(|c| c.get(1)?.as_str().parse().ok())
                .filter(|&id| id != 0)
                .collect();
        }
        vec![]
    }

    pub fn count_list_entries(&self, field_name: &str) -> u32 {
        let start_pattern = format!("{}:", field_name);
        if let Some(start) = self.raw.find(&start_pattern) {
            let block = &self.raw[start + start_pattern.len()..];
            block.lines()
                .take_while(|l| l.starts_with("  ") || l.trim().starts_with('-'))
                .filter(|l| l.trim().starts_with('-'))
                .count() as u32
        } else {
            0
        }
    }
}

pub fn parse_documents(text: &str) -> Vec<UnityDocument> {
    let header_re = Regex::new(r"--- !u!(\d+) &(\d+)").unwrap();
    let mut docs = Vec::new();
    let mut positions: Vec<(usize, u32, u64)> = Vec::new();

    for cap in header_re.captures_iter(text) {
        let pos = cap.get(0).unwrap().start();
        let class_id: u32 = cap[1].parse().unwrap_or(0);
        let file_id: u64 = cap[2].parse().unwrap_or(0);
        positions.push((pos, class_id, file_id));
    }

    for (i, &(pos, class_id, file_id)) in positions.iter().enumerate() {
        let end = if i + 1 < positions.len() { positions[i + 1].0 } else { text.len() };
        let raw = text[pos..end].to_string();
        docs.push(UnityDocument { class_id, file_id, raw });
    }

    docs
}

pub fn build_index(docs: &[UnityDocument]) -> HashMap<u64, &UnityDocument> {
    docs.iter().map(|d| (d.file_id, d)).collect()
}

pub fn find_gameobject_by_name<'a>(
    docs: &'a [UnityDocument],
    name: &str,
) -> Vec<&'a UnityDocument> {
    docs.iter()
        .filter(|d| d.class_id == 1)
        .filter(|d| {
            d.get_field("m_Name")
                .map(|n| n == name)
                .unwrap_or(false)
        })
        .collect()
}
