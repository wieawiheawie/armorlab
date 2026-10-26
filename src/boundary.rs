use std::collections::HashMap;

const CSV: &str = include_str!("../research/ArmorLab_Research_Pack/data/boundary_model_parameters.csv");
const REQUIRED_HEADERS: &[&str] = &[
    "model_id", "model_type", "target_id", "solver_mode", "availability",
    "foundation_stiffness", "foundation_stiffness_unit", "foundation_damping", "foundation_damping_unit",
    "normal_stiffness", "normal_stiffness_unit", "shear_stiffness", "shear_stiffness_unit",
    "normal_strength", "normal_strength_unit", "shear_strength", "shear_strength_unit",
    "mode_i_fracture_energy", "mode_i_fracture_energy_unit", "mode_ii_fracture_energy",
    "mode_ii_fracture_energy_unit", "mixed_mode_exponent", "mixed_mode_exponent_unit",
    "effective_area", "effective_area_unit", "normal_x", "normal_y", "normal_unit",
    "tangent_x", "tangent_y", "tangent_unit", "source_reference", "material_or_joint",
    "confidence", "uncertainty", "notes",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryType {
    Free,
    RigidFixture,
    CompliantFoundation,
    CohesiveInterface,
}

impl BoundaryType {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "free" => Ok(Self::Free),
            "rigid_fixture" => Ok(Self::RigidFixture),
            "compliant_foundation" => Ok(Self::CompliantFoundation),
            "cohesive_interface" => Ok(Self::CohesiveInterface),
            _ => Err(format!("unknown boundary model type: {value}")),
        }
    }

    pub fn solver_mode(self) -> Option<u8> {
        match self {
            Self::RigidFixture => Some(0),
            Self::Free => Some(1),
            Self::CompliantFoundation => Some(2),
            Self::CohesiveInterface => None,
        }
    }

    pub fn from_solver_mode(mode: u8) -> Result<Self, String> {
        match mode {
            0 => Ok(Self::RigidFixture),
            1 => Ok(Self::Free),
            2 => Ok(Self::CompliantFoundation),
            _ => Err(format!("unsupported solver boundary mode: {mode}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Availability {
    Implemented,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CohesiveParameters {
    pub normal_stiffness_pa_per_m: Option<f64>,
    pub shear_stiffness_pa_per_m: Option<f64>,
    pub normal_strength_pa: Option<f64>,
    pub shear_strength_pa: Option<f64>,
    pub mode_i_fracture_energy_j_per_m2: Option<f64>,
    pub mode_ii_fracture_energy_j_per_m2: Option<f64>,
    pub mixed_mode_exponent: Option<f64>,
    pub effective_area_m2: Option<f64>,
    pub local_normal: Option<[f64; 2]>,
    pub local_tangent: Option<[f64; 2]>,
}

impl CohesiveParameters {
    pub fn is_complete(&self) -> bool {
        self.normal_stiffness_pa_per_m.is_some()
            && self.shear_stiffness_pa_per_m.is_some()
            && self.normal_strength_pa.is_some()
            && self.shear_strength_pa.is_some()
            && self.mode_i_fracture_energy_j_per_m2.is_some()
            && self.mode_ii_fracture_energy_j_per_m2.is_some()
            && self.mixed_mode_exponent.is_some()
            && self.effective_area_m2.is_some()
            && self.local_normal.is_some()
            && self.local_tangent.is_some()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BoundaryModel {
    pub id: String,
    pub model_type: BoundaryType,
    pub target_id: String,
    pub solver_mode: Option<u8>,
    pub availability: Availability,
    pub foundation_stiffness_pa_per_m: Option<f64>,
    pub foundation_damping_pa_s_per_m: Option<f64>,
    pub cohesive: CohesiveParameters,
    pub source_reference: String,
    pub material_or_joint: String,
    pub confidence: String,
    pub uncertainty: String,
    pub notes: String,
}

impl BoundaryModel {
    pub fn solver_parameters(&self) -> Result<(u8, f64, f64), String> {
        if self.availability != Availability::Implemented {
            return Err(format!("boundary model '{}' is unsupported: {}", self.id, self.uncertainty));
        }
        let mode = self.solver_mode.ok_or_else(|| format!("boundary model '{}' has no solver mode", self.id))?;
        let (stiffness, damping) = match self.model_type {
            BoundaryType::Free | BoundaryType::RigidFixture => {
                if self.foundation_stiffness_pa_per_m.is_some() || self.foundation_damping_pa_s_per_m.is_some() {
                    return Err(format!("boundary model '{}' cannot carry foundation coefficients", self.id));
                }
                (0.0, 0.0)
            }
            BoundaryType::CompliantFoundation => (
                self.foundation_stiffness_pa_per_m.ok_or_else(|| format!("boundary model '{}' is missing stiffness", self.id))?,
                self.foundation_damping_pa_s_per_m.ok_or_else(|| format!("boundary model '{}' is missing damping", self.id))?,
            ),
            BoundaryType::CohesiveInterface => {
                if !self.cohesive.is_complete() {
                    return Err(format!("boundary model '{}' is unsupported: cohesive-interface parameters or implementation are missing", self.id));
                }
                return Err(format!("boundary model '{}' is unsupported: the solver has no cohesive-interface damage law", self.id));
            }
        };
        Ok((mode, stiffness, damping))
    }
}

#[derive(Clone, Debug)]
pub struct BoundaryDatabase {
    models: Vec<BoundaryModel>,
}

impl BoundaryDatabase {
    pub fn parse(csv: &str) -> Result<Self, String> {
        let records = parse_csv(csv)?;
        let headers = records.first().ok_or_else(|| "boundary CSV has no header".to_string())?;
        for required in REQUIRED_HEADERS {
            if !headers.iter().any(|header| header == required) {
                return Err(format!("boundary CSV is missing required header '{required}'"));
            }
        }
        let mut models = Vec::with_capacity(records.len().saturating_sub(1));
        let mut ids = std::collections::HashSet::new();
        for (line, cells) in records.iter().enumerate().skip(1) {
            if cells.len() != headers.len() {
                return Err(format!("boundary CSV row {} has {} fields; expected {}", line + 1, cells.len(), headers.len()));
            }
            let row: HashMap<&str, &str> = headers.iter().map(String::as_str).zip(cells.iter().map(String::as_str)).collect();
            let get = |name: &str| row.get(name).copied().unwrap_or("").trim();
            let id = required(get("model_id"), "model_id", line)?;
            if !ids.insert(id.to_string()) {
                return Err(format!("boundary CSV contains duplicate model_id '{id}'"));
            }
            let model_type = BoundaryType::parse(get("model_type"))?;
            let availability = match get("availability") {
                "implemented" => Availability::Implemented,
                "unsupported" => Availability::Unsupported,
                value => return Err(format!("boundary CSV row {} has invalid availability '{value}'", line + 2)),
            };
            let solver_mode = optional_u8(get("solver_mode"), "solver_mode", line)?;
            if solver_mode != model_type.solver_mode() {
                return Err(format!("boundary CSV row {} has a solver_mode inconsistent with model_type", line + 2));
            }

            let foundation_stiffness_pa_per_m = numeric(get("foundation_stiffness"), "foundation_stiffness", line)?;
            let foundation_damping_pa_s_per_m = numeric(get("foundation_damping"), "foundation_damping", line)?;
            validate_unit(&row, "foundation_stiffness_unit", "Pa/m", line)?;
            validate_unit(&row, "foundation_damping_unit", "Pa*s/m", line)?;
            if model_type == BoundaryType::CompliantFoundation && availability == Availability::Implemented {
                let k = foundation_stiffness_pa_per_m.ok_or_else(|| format!("boundary CSV row {} is missing foundation stiffness", line + 2))?;
                let c = foundation_damping_pa_s_per_m.ok_or_else(|| format!("boundary CSV row {} is missing foundation damping", line + 2))?;
                if k <= 0.0 || c < 0.0 {
                    return Err(format!("boundary CSV row {} requires stiffness > 0 and damping >= 0", line + 2));
                }
            } else if model_type != BoundaryType::CompliantFoundation
                && (foundation_stiffness_pa_per_m.is_some() || foundation_damping_pa_s_per_m.is_some())
            {
                return Err(format!("boundary CSV row {} assigns foundation coefficients to a non-foundation model", line + 2));
            }

            let cohesive = CohesiveParameters {
                normal_stiffness_pa_per_m: numeric(get("normal_stiffness"), "normal_stiffness", line)?,
                shear_stiffness_pa_per_m: numeric(get("shear_stiffness"), "shear_stiffness", line)?,
                normal_strength_pa: numeric(get("normal_strength"), "normal_strength", line)?,
                shear_strength_pa: numeric(get("shear_strength"), "shear_strength", line)?,
                mode_i_fracture_energy_j_per_m2: numeric(get("mode_i_fracture_energy"), "mode_i_fracture_energy", line)?,
                mode_ii_fracture_energy_j_per_m2: numeric(get("mode_ii_fracture_energy"), "mode_ii_fracture_energy", line)?,
                mixed_mode_exponent: numeric(get("mixed_mode_exponent"), "mixed_mode_exponent", line)?,
                effective_area_m2: numeric(get("effective_area"), "effective_area", line)?,
                local_normal: vector2(&row, "normal_x", "normal_y", line)?,
                local_tangent: vector2(&row, "tangent_x", "tangent_y", line)?,
            };
            for (unit_column, expected) in [
                ("normal_stiffness_unit", "Pa/m"), ("shear_stiffness_unit", "Pa/m"),
                ("normal_strength_unit", "Pa"), ("shear_strength_unit", "Pa"),
                ("mode_i_fracture_energy_unit", "J/m^2"), ("mode_ii_fracture_energy_unit", "J/m^2"),
                ("mixed_mode_exponent_unit", "dimensionless"), ("effective_area_unit", "m^2"),
                ("normal_unit", "dimensionless"), ("tangent_unit", "dimensionless"),
            ] {
                validate_unit(&row, unit_column, expected, line)?;
                if model_type == BoundaryType::CohesiveInterface
                    && row.get(unit_column).copied().unwrap_or("").trim() != expected
                {
                    return Err(format!("boundary CSV row {} is missing explicit unit '{expected}' in '{unit_column}'", line + 2));
                }
            }
            for (name, value) in [
                ("normal stiffness", cohesive.normal_stiffness_pa_per_m),
                ("shear stiffness", cohesive.shear_stiffness_pa_per_m),
                ("normal strength", cohesive.normal_strength_pa),
                ("shear strength", cohesive.shear_strength_pa),
                ("mode-I fracture energy", cohesive.mode_i_fracture_energy_j_per_m2),
                ("mode-II fracture energy", cohesive.mode_ii_fracture_energy_j_per_m2),
                ("mixed-mode exponent", cohesive.mixed_mode_exponent),
                ("effective area", cohesive.effective_area_m2),
            ] {
                if value.is_some_and(|v| v <= 0.0) {
                    return Err(format!("boundary CSV row {} has non-positive {name}", line + 2));
                }
            }
            if let (Some(n), Some(t)) = (cohesive.local_normal, cohesive.local_tangent) {
                let norm_n = n[0].hypot(n[1]);
                let norm_t = t[0].hypot(t[1]);
                if (norm_n - 1.0).abs() > 1e-6 || (norm_t - 1.0).abs() > 1e-6
                    || (n[0] * t[0] + n[1] * t[1]).abs() > 1e-6
                {
                    return Err(format!("boundary CSV row {} local normal/tangent must be orthonormal unit vectors", line + 2));
                }
            }
            if model_type == BoundaryType::CohesiveInterface
                && availability == Availability::Implemented
                && !cohesive.is_complete()
            {
                return Err(format!("boundary CSV row {} enables a cohesive interface without complete constitutive parameters", line + 2));
            }

            models.push(BoundaryModel {
                id: id.to_string(),
                model_type,
                target_id: required(get("target_id"), "target_id", line)?.to_string(),
                solver_mode,
                availability,
                foundation_stiffness_pa_per_m,
                foundation_damping_pa_s_per_m,
                cohesive,
                source_reference: required(get("source_reference"), "source_reference", line)?.to_string(),
                material_or_joint: required(get("material_or_joint"), "material_or_joint", line)?.to_string(),
                confidence: required(get("confidence"), "confidence", line)?.to_string(),
                uncertainty: required(get("uncertainty"), "uncertainty", line)?.to_string(),
                notes: required(get("notes"), "notes", line)?.to_string(),
            });
        }
        Ok(Self { models })
    }

    pub fn embedded() -> Result<Self, String> {
        Self::parse(CSV)
    }

    pub fn resolve(&self, target_id: &str, model_type: BoundaryType) -> Result<&BoundaryModel, String> {
        self.models.iter().find(|model| model.model_type == model_type && model.target_id == target_id)
            .or_else(|| self.models.iter().find(|model| model.model_type == model_type && model.target_id == "*"))
            .ok_or_else(|| format!("no {:?} boundary model is configured for target '{target_id}'", model_type))
    }

    pub fn models(&self) -> &[BoundaryModel] {
        &self.models
    }
}

fn required<'a>(value: &'a str, name: &str, line: usize) -> Result<&'a str, String> {
    if value.is_empty() {
        Err(format!("boundary CSV row {} is missing required field '{name}'", line + 2))
    } else {
        Ok(value)
    }
}

fn numeric(value: &str, name: &str, line: usize) -> Result<Option<f64>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    let parsed = value.parse::<f64>().map_err(|_| format!("boundary CSV row {} has malformed number in '{name}'", line + 2))?;
    if !parsed.is_finite() {
        return Err(format!("boundary CSV row {} has non-finite number in '{name}'", line + 2));
    }
    Ok(Some(parsed))
}

fn optional_u8(value: &str, name: &str, line: usize) -> Result<Option<u8>, String> {
    if value.is_empty() { return Ok(None); }
    value.parse::<u8>().map(Some).map_err(|_| format!("boundary CSV row {} has invalid integer in '{name}'", line + 2))
}

fn validate_unit(row: &HashMap<&str, &str>, column: &str, expected: &str, line: usize) -> Result<(), String> {
    let value = row.get(column).copied().unwrap_or("").trim();
    if !value.is_empty() && value != expected {
        return Err(format!("boundary CSV row {} has invalid unit '{value}' in '{column}'; expected '{expected}'", line + 2));
    }
    Ok(())
}

fn vector2(row: &HashMap<&str, &str>, x: &str, y: &str, line: usize) -> Result<Option<[f64; 2]>, String> {
    let vx = numeric(row.get(x).copied().unwrap_or("").trim(), x, line)?;
    let vy = numeric(row.get(y).copied().unwrap_or("").trim(), y, line)?;
    match (vx, vy) {
        (None, None) => Ok(None),
        (Some(x), Some(y)) => Ok(Some([x, y])),
        _ => Err(format!("boundary CSV row {} must provide both local direction components", line + 2)),
    }
}

fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = text.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        if quoted {
            match ch {
                '"' if chars.peek() == Some(&'"') => { field.push('"'); chars.next(); }
                '"' => quoted = false,
                _ => field.push(ch),
            }
        } else {
            match ch {
                '"' if field.is_empty() => quoted = true,
                '"' => return Err("boundary CSV has an unexpected quote in an unquoted field".into()),
                ',' => row.push(std::mem::take(&mut field)),
                '\n' | '\r' => {
                    if ch == '\r' && chars.peek() == Some(&'\n') { chars.next(); }
                    row.push(std::mem::take(&mut field));
                    if row.iter().any(|cell| !cell.is_empty()) { records.push(std::mem::take(&mut row)); }
                    else { row.clear(); }
                }
                _ => field.push(ch),
            }
        }
    }
    if quoted { return Err("boundary CSV has an unterminated quoted field".into()); }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|cell| !cell.is_empty()) { records.push(row); }
    }
    if records.is_empty() { return Err("boundary CSV has no header".into()); }
    if records[0].iter().any(|header| header.trim().is_empty()) {
        return Err("boundary CSV has an empty header".into());
    }
    let mut seen = std::collections::HashSet::new();
    if records[0].iter().any(|header| !seen.insert(header.as_str())) {
        return Err("boundary CSV has duplicate headers".into());
    }
    let width = records[0].len();
    for (index, record) in records.iter().enumerate().skip(1) {
        if record.len() != width {
            return Err(format!("boundary CSV row {} has {} fields; expected {width}", index + 1, record.len()));
        }
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> String { CSV.to_string() }

    #[test]
    fn embedded_models_parse_with_provenance_units_and_unresolved_weld_data() {
        let db = BoundaryDatabase::embedded().unwrap();
        assert_eq!(db.models().len(), 4);
        let foundation = db.resolve("TIGER2_UPPER_GLACIS", BoundaryType::CompliantFoundation).unwrap();
        assert_eq!(foundation.solver_parameters().unwrap(), (2, 1.0e12, 0.0));
        assert_eq!(foundation.confidence, "provisional numerical reference");
        assert!(foundation.uncertainty.contains("Not measured"));
        let weld = db.resolve("TIGER2_UPPER_GLACIS", BoundaryType::CohesiveInterface).unwrap();
        assert_eq!(weld.source_reference, "S14;S16");
        assert_eq!(weld.cohesive.normal_stiffness_pa_per_m, None);
        assert!(weld.solver_parameters().unwrap_err().contains("unsupported"));
    }

    #[test]
    fn parser_rejects_missing_headers_rows_and_malformed_or_nonfinite_numbers() {
        let csv = sample();
        assert!(BoundaryDatabase::parse(&csv.replace("model_type,", "")).unwrap_err().contains("fields; expected"));
        assert!(BoundaryDatabase::parse(&csv.replace("free,free,*,1,implemented,", "free,free,*,1,implemented")).unwrap_err().contains("fields"));
        assert!(BoundaryDatabase::parse(&csv.replace("1e12,Pa/m", "not-a-number,Pa/m")).unwrap_err().contains("malformed number"));
        assert!(BoundaryDatabase::parse(&csv.replace("1e12,Pa/m", "NaN,Pa/m")).unwrap_err().contains("non-finite"));
    }

    #[test]
    fn parser_rejects_negative_values_wrong_units_and_incomplete_enabled_interfaces() {
        let csv = sample();
        assert!(BoundaryDatabase::parse(&csv.replace("1e12,Pa/m", "-1,Pa/m")).unwrap_err().contains("stiffness > 0"));
        assert!(BoundaryDatabase::parse(&csv.replace("1e12,Pa/m", "1e12,Pa")).unwrap_err().contains("invalid unit"));
        let enabled = csv.replace("tiger2_glacis_weld,cohesive_interface,TIGER2_UPPER_GLACIS,,unsupported", "tiger2_glacis_weld,cohesive_interface,TIGER2_UPPER_GLACIS,,implemented");
        assert!(BoundaryDatabase::parse(&enabled).unwrap_err().contains("without complete constitutive parameters"));
    }
}
