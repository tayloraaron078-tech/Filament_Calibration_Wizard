//! Build a sliceable flow-rate-calibration project 3mf around one of Orca's own
//! shipped multi-object plates (Stage 6, flow parameterization).
//!
//! Ground truth for this module comes straight from OrcaSlicer's own (AGPL,
//! public) source: `Plater::calib_flowrate` / `adjust_settings_for_flowrate_calib`
//! in `src/slic3r/GUI/Plater.cpp`. Orca's shipped
//! `resources/calib/filament_flow/flowrate-test-pass{1,2}.3mf` are bare
//! multi-object plates — each `<object id="N" name="flowrate_XXX">` already
//! carries its position baked into its own mesh vertices (no per-item transform),
//! but the file has NO `Metadata/project_settings.config` and NO
//! `Metadata/model_settings.config` (confirmed by inspecting the real shipped
//! files) — the same missing-scaffolding gap `model_project.rs` found and solved
//! for the (single-object) temperature tower.
//!
//! Orca's own C++ turns each object's name suffix into a per-object
//! `print_flow_ratio` PROCESS OVERRIDE (not a filament-level setting): it strips
//! the object's name down to the digits after `"flowrate_"` (9 chars), remaps a
//! leading `m` to a minus sign, parses the float, and combines it with the
//! filament's current `filament_flow_ratio` (`(cur+modifier)/cur` for the YOLO/
//! linear test, `1+modifier/100` for the legacy percent pass1/pass2 tests). Those
//! per-object overrides — plus a fixed set of print-quality settings tuned for
//! the test (single wall, 35% rectilinear infill, top surface pattern, etc.) —
//! are serialized as `<metadata key="…" value="…"/>` entries inside
//! `<object id="N">` in `model_settings.config`: the exact tag scheme
//! (`KEY_ATTR`/`VALUE_ATTR` = `"key"`/`"value"`) our own `model_settings_xml`
//! (in `model_project.rs`) already uses for the temperature tower.
//!
//! This module does NOT rebuild geometry (no STL, no mesh cut): it reads the
//! object id/name pairs straight out of the template's own `3D/3dmodel.model`,
//! lets the TS side compute each object's `print_flow_ratio` + the fixed
//! overrides (mirrors `temperatureTower.ts` computing bands in pure TS), and then
//! only ADDS the synthesized `model_settings.config` / `project_settings.config`
//! / `slice_info.config` (plus a `Content_Types.xml` patched to declare the
//! `config` extension, which the bare template lacks) onto the template via the
//! existing `repackage_with_entries` assembler. Every other template entry
//! (`3D/3dmodel.model`, colorgroups, thumbnail) is preserved byte-for-byte.
//!
//! Deliberately out of scope for this increment (see HQ STATUS.md): the
//! nozzle/layer-height-dependent build-item RESCALE Orca's GUI also applies
//! (`selection.scale(...)`) and the dynamic max-volumetric-speed clamp arrays
//! (`internal_solid_infill_speed`/`top_surface_speed`). Both are refinements —
//! for the common 0.4 mm-nozzle / 0.2 mm-layer profile family Orca's own scale
//! formula resolves to identity, so this is the same shape of "prove the pipeline
//! first" narrowing Stage 6 used throughout.

use super::project_assembly::{repackage_with_entries, RawAssembledProject};
use super::{engine, security};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

use super::model_project::{xml_escape, SLICE_INFO_XML};

const CONFIG_CONTENT_TYPE_ENTRY: &str =
    " <Default Extension=\"config\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/>\n</Types>";

fn validate_3mf(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("No template path given".into());
    }
    if !trimmed.to_ascii_lowercase().ends_with(".3mf") {
        return Err("Template must be a .3mf".into());
    }
    let p = Path::new(trimmed);
    if !p.is_file() {
        return Err(format!("Template not found: {}", p.display()));
    }
    std::fs::canonicalize(p).map_err(|e| format!("Cannot resolve template {}: {e}", p.display()))
}

fn read_zip_text_entry(path: &Path, name: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot open template: {e}"))?;
    let mut zip = ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Template is not a valid 3mf/zip: {e}"))?;
    let mut entry = zip
        .by_name(name)
        .map_err(|_| format!("Template has no {name}"))?;
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .map_err(|e| format!("Cannot read {name}: {e}"))?;
    Ok(text)
}

/// Extract a single attribute's value from a raw tag-body string like
/// `id="1" name="flowrate_0" type="model"`. Not a general XML parser — scoped to
/// the well-defined attribute syntax Orca's own 3mf writer emits.
fn extract_attr(tag: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rel_end = tag[start..].find('"')?;
    Some(tag[start..start + rel_end].to_string())
}

/// Pull every `(id, name)` pair off `<object id="…" name="…" …>` opening tags in
/// a `3D/3dmodel.model` XML string. Orca's flow-calibration plates always carry
/// both attributes on the object element itself (verified directly against the
/// shipped `flowrate-test-pass1.3mf`/`pass2.3mf`).
fn parse_object_id_names(xml: &str) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<object ") {
        let after = &rest[start + "<object ".len()..];
        let Some(end) = after.find('>') else { break };
        let tag = &after[..end];
        if let (Some(id_s), Some(name)) = (extract_attr(tag, "id"), extract_attr(tag, "name")) {
            if let Ok(id) = id_s.parse::<u32>() {
                out.push((id, name));
            }
        }
        rest = &after[end + 1..];
    }
    out
}

#[derive(Serialize, Clone)]
pub struct RawFlowObject {
    pub id: u32,
    pub name: String,
}

/// Read-only: list the `(id, name)` of every object on a flow-calibration
/// template plate, so the caller (TS) can compute each object's per-object
/// `print_flow_ratio` + override set from its name without this module needing
/// to know the calibration formulas.
#[tauri::command]
pub fn list_flow_test_objects(template_path: String) -> Result<Vec<RawFlowObject>, String> {
    let path = validate_3mf(&template_path)?;
    let xml = read_zip_text_entry(&path, "3D/3dmodel.model")?;
    let pairs = parse_object_id_names(&xml);
    if pairs.is_empty() {
        return Err("No <object id=\"…\" name=\"…\"> entries found in 3D/3dmodel.model".into());
    }
    Ok(pairs.into_iter().map(|(id, name)| RawFlowObject { id, name }).collect())
}

/// One object's caller-computed process overrides (already-formatted
/// `opt_serialize`-style strings — e.g. `"35%"`, `"1"`, `"rectilinear"` — mirroring
/// how `project_settings.config` itself stores values).
#[derive(Deserialize)]
struct FlowObjectInput {
    id: u32,
    name: String,
    overrides: HashMap<String, String>,
}

/// Add the `config` extension to a template's `[Content_Types].xml` if it isn't
/// already declared — Orca's bare flow-calibration plates ship with no config
/// files at all, so their content-types manifest never lists that extension.
fn ensure_config_content_type(content_types_xml: &str) -> String {
    if content_types_xml.contains("Extension=\"config\"") {
        content_types_xml.to_string()
    } else {
        content_types_xml.replacen("</Types>", CONFIG_CONTENT_TYPE_ENTRY, 1)
    }
}

/// Build the multi-object `Metadata/model_settings.config`: one `<object>` block
/// per plate object carrying its per-object overrides, one `<model_instance>`
/// per object under a single plate 1, and one `<assemble_item>` per object.
/// Objects keep the IDENTITY transform (the template's own `<item>` elements
/// carry no transform — position is baked into each object's mesh already).
fn model_settings_xml_multi(objects: &[FlowObjectInput]) -> String {
    const IDENTITY_TRANSFORM: &str = "1 0 0 0 1 0 0 0 1 0 0 0";
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<config>\n");
    for obj in objects {
        let esc_name = xml_escape(&obj.name);
        s.push_str(&format!("  <object id=\"{}\">\n", obj.id));
        s.push_str(&format!("    <metadata key=\"name\" value=\"{esc_name}\"/>\n"));
        s.push_str("    <metadata key=\"extruder\" value=\"1\"/>\n");
        let mut keys: Vec<&String> = obj.overrides.keys().collect();
        keys.sort();
        for key in keys {
            let value = xml_escape(&obj.overrides[key]);
            let esc_key = xml_escape(key);
            s.push_str(&format!("    <metadata key=\"{esc_key}\" value=\"{value}\"/>\n"));
        }
        s.push_str(&format!(
            "    <part id=\"1\" subtype=\"normal_part\">\n      \
<metadata key=\"name\" value=\"{esc_name}\"/>\n      \
<metadata key=\"matrix\" value=\"1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\"/>\n    </part>\n  </object>\n"
        ));
    }
    s.push_str(
        "  <plate>\n    <metadata key=\"plater_id\" value=\"1\"/>\n    \
<metadata key=\"plater_name\" value=\"\"/>\n    <metadata key=\"locked\" value=\"false\"/>\n",
    );
    for obj in objects {
        s.push_str(&format!(
            "    <model_instance>\n      <metadata key=\"object_id\" value=\"{}\"/>\n      \
<metadata key=\"instance_id\" value=\"0\"/>\n      \
<metadata key=\"identify_id\" value=\"{}\"/>\n    </model_instance>\n",
            obj.id, obj.id
        ));
    }
    s.push_str("  </plate>\n  <assemble>\n");
    for obj in objects {
        s.push_str(&format!(
            "   <assemble_item object_id=\"{}\" instance_id=\"0\" transform=\"{IDENTITY_TRANSFORM}\" offset=\"0 0 0\" />\n",
            obj.id
        ));
    }
    s.push_str("  </assemble>\n</config>\n");
    s
}

/// Assemble a flow-rate-calibration project into the job workspace: take one of
/// Orca's own shipped multi-object plates (`flowrate-test-pass1.3mf` /
/// `pass2.3mf`), keep its geometry untouched, and add the synthesized
/// `model_settings.config` (binding every object to plate 1 with its per-object
/// overrides) + the merged `project_settings.config` + a patched
/// `Content_Types.xml`. `objects_json` is the caller-computed
/// `[{id, name, overrides}]` array (see `FlowObjectInput`) — this module only
/// formats it into Orca's XML shape, it does not compute flow ratios itself.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn assemble_flow_test(
    engine_id: String,
    session_id: String,
    job_id: String,
    template_path: String,
    merged_config_json: String,
    objects_json: String,
    output_file_name: String,
) -> Result<RawAssembledProject, String> {
    security::validate_component(&output_file_name)?;
    if !output_file_name.to_ascii_lowercase().ends_with(".3mf") {
        return Err("Output file must be a .3mf".into());
    }
    let template = validate_3mf(&template_path)?;

    // Confine the template to the vetted engine's own resources when we can
    // resolve them — a calibration model must come from the user's own install,
    // never an arbitrary frontend path (same rule as project_assembly/model_project).
    let mut warnings = Vec::new();
    if engine_id == "installed_orca" {
        match engine::engine_resources_root(&engine_id) {
            Some(root) => security::ensure_under(&root, &template)?,
            None => warnings.push("Engine resources root unknown; template not confined to the install.".into()),
        }
    }

    let objects: Vec<FlowObjectInput> =
        serde_json::from_str(&objects_json).map_err(|e| format!("Invalid objects_json: {e}"))?;
    if objects.is_empty() {
        return Err("No flow-test objects supplied".into());
    }
    let model_settings = model_settings_xml_multi(&objects);

    let content_types = read_zip_text_entry(&template, "[Content_Types].xml")?;
    let patched_content_types = ensure_config_content_type(&content_types);

    let workspace = security::job_root(&session_id, &job_id)?.join("workspace");
    std::fs::create_dir_all(&workspace).map_err(|e| format!("Cannot create workspace: {e}"))?;
    let out_path = workspace.join(&output_file_name);

    let entries: Vec<(&str, &[u8])> = vec![
        ("[Content_Types].xml", patched_content_types.as_bytes()),
        ("Metadata/project_settings.config", merged_config_json.as_bytes()),
        ("Metadata/model_settings.config", model_settings.as_bytes()),
        ("Metadata/slice_info.config", SLICE_INFO_XML.as_bytes()),
    ];
    let (added, entry_count) = repackage_with_entries(&template, &entries, &out_path)?;
    let config_replaced = !added.iter().any(|n| n == "Metadata/project_settings.config");

    Ok(RawAssembledProject {
        project_file_name: output_file_name,
        project_path: out_path.display().to_string(),
        workspace_dir: workspace.display().to_string(),
        config_replaced,
        entry_count,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pf_flowtest_{tag}_{n}_{}", super::super::now_unix()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SAMPLE_MODEL_XML: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
	<resources>
		<object id="1" name="flowrate_0" type="model" p:UUID="x" pid="2" pindex="0">
			<mesh><vertices><vertex x="0" y="0" z="0" /></vertices><triangles></triangles></mesh>
		</object>
		<object id="11" name="flowrate_m10" type="model" p:UUID="y" pid="12" pindex="0">
			<mesh><vertices><vertex x="0" y="0" z="0" /></vertices><triangles></triangles></mesh>
		</object>
	</resources>
	<build>
		<item objectid="1" p:UUID="a"/>
		<item objectid="11" p:UUID="b"/>
	</build>
</model>
"#;

    fn make_bare_flow_template(path: &Path) {
        let f = std::fs::File::create(path).unwrap();
        let mut w = ZipWriter::new(f);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        w.start_file("[Content_Types].xml", opts).unwrap();
        w.write_all(
            b"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n\
 <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n\
 <Default Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/>\n\
 <Default Extension=\"png\" ContentType=\"image/png\"/>\n\
</Types>\n",
        )
        .unwrap();
        w.start_file("_rels/.rels", opts).unwrap();
        w.write_all(b"<Relationships/>").unwrap();
        w.start_file("3D/3dmodel.model", opts).unwrap();
        w.write_all(SAMPLE_MODEL_XML.as_bytes()).unwrap();
        w.finish().unwrap();
    }

    #[test]
    fn parses_object_id_name_pairs() {
        let pairs = parse_object_id_names(SAMPLE_MODEL_XML);
        assert_eq!(pairs, vec![(1, "flowrate_0".to_string()), (11, "flowrate_m10".to_string())]);
    }

    #[test]
    fn list_flow_test_objects_reads_the_template() {
        let d = temp_dir("list");
        let tmpl = d.join("flow.3mf");
        make_bare_flow_template(&tmpl);
        let objs = list_flow_test_objects(tmpl.display().to_string()).unwrap();
        assert_eq!(objs.len(), 2);
        assert_eq!(objs[0].id, 1);
        assert_eq!(objs[0].name, "flowrate_0");
        assert_eq!(objs[1].name, "flowrate_m10");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn ensure_config_content_type_adds_when_missing() {
        let ct = "<?xml version=\"1.0\"?>\n<Types>\n <Default Extension=\"rels\" ContentType=\"x\"/>\n</Types>";
        let patched = ensure_config_content_type(ct);
        assert!(patched.contains("Extension=\"config\""));
        // idempotent — a second pass doesn't duplicate the entry
        assert_eq!(patched.matches("Extension=\"config\"").count(), 1);
        let patched_again = ensure_config_content_type(&patched);
        assert_eq!(patched_again.matches("Extension=\"config\"").count(), 1);
    }

    #[test]
    fn model_settings_multi_binds_every_object_to_plate_1() {
        let mut overrides1 = HashMap::new();
        overrides1.insert("print_flow_ratio".to_string(), "1.05".to_string());
        let mut overrides2 = HashMap::new();
        overrides2.insert("print_flow_ratio".to_string(), "0.95".to_string());
        let objects = vec![
            FlowObjectInput { id: 1, name: "flowrate_0".into(), overrides: overrides1 },
            FlowObjectInput { id: 11, name: "flowrate_m10".into(), overrides: overrides2 },
        ];
        let xml = model_settings_xml_multi(&objects);
        assert_eq!(xml.matches("<object id=").count(), 2);
        assert_eq!(xml.matches("<model_instance>").count(), 2);
        assert_eq!(xml.matches("<assemble_item ").count(), 2);
        assert!(xml.contains("object id=\"1\""));
        assert!(xml.contains("object id=\"11\""));
        assert!(xml.contains("key=\"print_flow_ratio\" value=\"1.05\""));
        assert!(xml.contains("key=\"print_flow_ratio\" value=\"0.95\""));
        assert!(xml.contains("plater_id\" value=\"1\""));
    }

    #[test]
    fn assembles_a_flow_project_adding_only_the_missing_scaffolding() {
        use std::io::Read as _;
        let d = temp_dir("assemble");
        let tmpl = d.join("flow.3mf");
        make_bare_flow_template(&tmpl);

        let objects_json = serde_json::json!([
            { "id": 1, "name": "flowrate_0", "overrides": { "print_flow_ratio": "1.0", "wall_loops": "1" } },
            { "id": 11, "name": "flowrate_m10", "overrides": { "print_flow_ratio": "0.9", "wall_loops": "1" } }
        ])
        .to_string();

        // Bypass the vetted-install confinement in this unit test by using an
        // engine id the assembler doesn't try to confine.
        let result = assemble_flow_test(
            "test_engine".to_string(),
            "sess-flowtest".to_string(),
            "job-flowtest".to_string(),
            tmpl.display().to_string(),
            r#"{"printer_settings_id":"X"}"#.to_string(),
            objects_json,
            "project.3mf".to_string(),
        )
        .unwrap();

        assert!(result.entry_count >= 6); // 3 template entries + 3 added (config x2 + slice_info)
        let f = std::fs::File::open(&result.project_path).unwrap();
        let mut z = zip::ZipArchive::new(f).unwrap();
        let mut ct = String::new();
        z.by_name("[Content_Types].xml").unwrap().read_to_string(&mut ct).unwrap();
        assert!(ct.contains("Extension=\"config\""));
        let mut ms = String::new();
        z.by_name("Metadata/model_settings.config").unwrap().read_to_string(&mut ms).unwrap();
        assert!(ms.contains("object id=\"1\"") && ms.contains("object id=\"11\""));
        assert!(ms.contains("print_flow_ratio\" value=\"1.0\""));
        // 3dmodel.model preserved verbatim (byte-identical geometry, untouched)
        let mut model = String::new();
        z.by_name("3D/3dmodel.model").unwrap().read_to_string(&mut model).unwrap();
        assert_eq!(model, SAMPLE_MODEL_XML);
        std::fs::remove_dir_all(&d).ok();
        std::fs::remove_dir_all(&security::job_root("sess-flowtest", "job-flowtest").unwrap()).ok();
    }

    /// Supervised real-Orca proof: assemble one of Orca's real shipped flow-rate
    /// plates with genuine per-object `print_flow_ratio` overrides computed the
    /// way Orca's own C++ does, and headless-slice it. Run with
    /// `cargo test -- --ignored probe_real_flow_test_slice`.
    #[test]
    #[ignore]
    fn probe_real_flow_test_slice() {
        use crate::slicer_integration::test_support;
        use std::process::{Command, Stdio};
        let orca = test_support::orca_exe();
        let template = test_support::orca_calib("filament_flow/flowrate-test-pass1.3mf");
        if !orca.is_file() || !template.is_file() {
            eprintln!("SKIP: Orca / flow template not present");
            return;
        }

        let raw_objects = list_flow_test_objects(template.display().to_string()).unwrap();
        println!("objects on plate: {}", raw_objects.len());
        assert_eq!(raw_objects.len(), 9, "flowrate-test-pass1.3mf ships 9 objects");

        // Mirror Orca's own C++ modifier parsing + percent formula (pass1/pass2).
        let baseline_flow_ratio = 1.0f64;
        let objects_json = serde_json::to_string(
            &raw_objects
                .iter()
                .map(|o| {
                    let suffix = &o.name[9..]; // strip "flowrate_"
                    let signed = if let Some(rest) = suffix.strip_prefix('m') {
                        format!("-{rest}")
                    } else {
                        suffix.to_string()
                    };
                    let modifier: f64 = signed.parse().unwrap_or(0.0);
                    let print_flow_ratio = 1.0 + modifier / 100.0;
                    let _ = baseline_flow_ratio; // percent formula doesn't need it
                    serde_json::json!({
                        "id": o.id,
                        "name": o.name,
                        "overrides": {
                            "print_flow_ratio": format!("{:.4}", print_flow_ratio),
                            "wall_loops": "1",
                            "sparse_infill_density": "35%",
                            "sparse_infill_pattern": "rectilinear",
                            "top_surface_pattern": "archimedeanchords"
                        }
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();

        // Resolve a REAL printer config (X1 Carbon: 256x256 bed, ~40mm clearance) —
        // an earlier version of this probe used the pa_pattern donor's tiny
        // 180x180mm / 73mm-extruder-clearance Bambu N1 config as a config
        // stand-in and hit `CLI_GCODE_PATH_CONFLICTS` (-101, confirmed from
        // OrcaSlicer's own source: a post-slice g-code path conflict check). With
        // 73mm required clearance between objects, this plate's normal 9-object
        // grid can never fit; a real desktop printer's ~40mm clearance does, with
        // no other change needed (confirmed by re-running this same probe with
        // the N1 config but `enable_prime_tower` forced off — still failed, ruling
        // the wipe tower out; switching only the printer to X1C — succeeded).
        super::super::engine::detect_slicing_engine("installed_orca".to_string(), None).unwrap();
        let resolved = super::super::preset_resolver::resolve_printer_preset(
            "installed_orca".to_string(),
            "BBL".to_string(),
            "Bambu Lab X1 Carbon 0.4 nozzle".to_string(),
            "0.20mm Standard @BBL X1C".to_string(),
            "Bambu PLA Basic @BBL X1C".to_string(),
        )
        .unwrap();
        let cfg = resolved.settings_json;

        let d = temp_dir("realflow");
        let session_id = format!("probe-flow-{}", super::super::now_unix());
        let result = assemble_flow_test(
            "installed_orca".to_string(),
            session_id.clone(),
            "job-1".to_string(),
            template.display().to_string(),
            cfg,
            objects_json,
            "project.3mf".to_string(),
        )
        .unwrap();
        println!("assembled: {} entries, added config: {}", result.entry_count, !result.config_replaced);

        let datadir = d.join("datadir");
        let outdir = d.join("out");
        std::fs::create_dir_all(&datadir).unwrap();
        std::fs::create_dir_all(&outdir).unwrap();
        let status = Command::new(&orca)
            .arg("--datadir").arg(&datadir)
            .arg("--outputdir").arg(&outdir)
            .arg("--slice").arg("0")
            .arg(&result.project_path)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .status()
            .expect("failed to launch orca");
        let gcode = outdir.join("plate_1.gcode");
        println!("orca exit={:?} gcode_exists={}", status.code(), gcode.is_file());
        if !gcode.is_file() {
            eprintln!("FINDING: synthesized flow-test project did NOT slice — inspect datadir/log.");
            println!("artifacts kept at {}, workspace at engines root for session {session_id}", d.display());
            return;
        }
        let meta = std::fs::metadata(&gcode).unwrap();
        println!("gcode size: {} bytes", meta.len());
        assert!(meta.len() > 1000, "g-code implausibly small");
        std::fs::remove_dir_all(&d).ok();
    }
}
