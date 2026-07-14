use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize};

const COLLAPSED_VISUAL_WIDTH: f64 = 84.0;
const COLLAPSED_VISUAL_HEIGHT: f64 = 84.0;
const EXPANDED_VISUAL_WIDTH: f64 = 328.0;
const EXPANDED_VISUAL_HEIGHT: f64 = 348.0;
const EDGE_SAFE_INSET_LOGICAL: f64 = 4.0;
const SNAP_THRESHOLD_LOGICAL: f64 = 24.0;
const POSITION_EPSILON: u32 = 2;

#[derive(Clone, Copy)]
enum HorizontalDock {
    Left,
    Right,
}

#[derive(Clone, Copy)]
enum VerticalDock {
    Top,
    Bottom,
}

#[derive(Clone, Copy, Default)]
struct DockState {
    horizontal: Option<HorizontalDock>,
    vertical: Option<VerticalDock>,
}

impl DockState {
    fn is_docked(self) -> bool {
        self.horizontal.is_some() || self.vertical.is_some()
    }
}

#[derive(Clone, Copy)]
struct WidgetRect {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct WorkAreaPoint {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct WorkAreaSize {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct WorkAreaPayload {
    position: WorkAreaPoint,
    size: WorkAreaSize,
}

impl WorkAreaPayload {
    fn as_rect(self) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(self.position.x, self.position.y),
            size: PhysicalSize::new(self.size.width, self.size.height),
        }
    }
}

#[derive(Clone, Copy)]
enum WidgetMode {
    Collapsed,
    Expanded,
}

#[derive(Clone, Copy)]
struct WidgetGeometryState {
    mode: WidgetMode,
    dock: DockState,
    collapsed_rect: WidgetRect,
    expanded_rect: Option<WidgetRect>,
    user_moved_expanded: bool,
}

#[derive(Default)]
pub(crate) struct GeometryController {
    geometry: Mutex<Option<WidgetGeometryState>>,
    drag_mode: Mutex<Option<WidgetMode>>,
}

fn logical_to_physical(value: f64, scale_factor: f64) -> u32 {
    (value * scale_factor).round().max(1.0) as u32
}

fn window_dimension_for_visual_size(visual_size: f64, scale_factor: f64, safe_inset: u32) -> u32 {
    logical_to_physical(visual_size, scale_factor) + safe_inset * 2
}

fn collapsed_size(scale_factor: f64, safe_inset: u32) -> PhysicalSize<u32> {
    PhysicalSize::new(
        window_dimension_for_visual_size(COLLAPSED_VISUAL_WIDTH, scale_factor, safe_inset),
        window_dimension_for_visual_size(COLLAPSED_VISUAL_HEIGHT, scale_factor, safe_inset),
    )
}

fn expanded_size(scale_factor: f64, safe_inset: u32) -> PhysicalSize<u32> {
    PhysicalSize::new(
        window_dimension_for_visual_size(EXPANDED_VISUAL_WIDTH, scale_factor, safe_inset),
        window_dimension_for_visual_size(EXPANDED_VISUAL_HEIGHT, scale_factor, safe_inset),
    )
}

fn clamp_position_to_bounds(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    bounds: PhysicalRect<i32, u32>,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let left = bounds.position.x;
    let top = bounds.position.y;
    let right = left + bounds.size.width as i32;
    let bottom = top + bounds.size.height as i32;
    let min_x = left - safe_inset;
    let min_y = top - safe_inset;
    let max_x = (right - size.width as i32 + safe_inset).max(min_x);
    let max_y = (bottom - size.height as i32 + safe_inset).max(min_y);
    PhysicalPosition::new(
        position.x.clamp(min_x, max_x),
        position.y.clamp(min_y, max_y),
    )
}

fn detect_dock(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    bounds: PhysicalRect<i32, u32>,
    threshold: i32,
    safe_inset: i32,
) -> DockState {
    let visible_left = position.x + safe_inset;
    let visible_top = position.y + safe_inset;
    let visible_right = position.x + size.width as i32 - safe_inset;
    let visible_bottom = position.y + size.height as i32 - safe_inset;
    let left_distance = (visible_left - bounds.position.x).abs();
    let top_distance = (visible_top - bounds.position.y).abs();
    let right_distance = (bounds.position.x + bounds.size.width as i32 - visible_right).abs();
    let bottom_distance = (bounds.position.y + bounds.size.height as i32 - visible_bottom).abs();
    let horizontal = if left_distance <= threshold || right_distance <= threshold {
        if left_distance <= right_distance {
            Some(HorizontalDock::Left)
        } else {
            Some(HorizontalDock::Right)
        }
    } else {
        None
    };
    let vertical = if top_distance <= threshold || bottom_distance <= threshold {
        if top_distance <= bottom_distance {
            Some(VerticalDock::Top)
        } else {
            Some(VerticalDock::Bottom)
        }
    } else {
        None
    };
    DockState {
        horizontal,
        vertical,
    }
}

fn snap_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    dock: DockState,
    bounds: PhysicalRect<i32, u32>,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let mut next = clamp_position_to_bounds(position, size, bounds, safe_inset);
    match dock.horizontal {
        Some(HorizontalDock::Left) => next.x = bounds.position.x - safe_inset,
        Some(HorizontalDock::Right) => {
            next.x = bounds.position.x + bounds.size.width as i32 - size.width as i32 + safe_inset;
        }
        None => {}
    }
    match dock.vertical {
        Some(VerticalDock::Top) => next.y = bounds.position.y - safe_inset,
        Some(VerticalDock::Bottom) => {
            next.y =
                bounds.position.y + bounds.size.height as i32 - size.height as i32 + safe_inset;
        }
        None => {}
    }
    next
}

fn expanded_position_in_bounds(
    collapsed: WidgetRect,
    expanded_size: PhysicalSize<u32>,
    dock: DockState,
    bounds: PhysicalRect<i32, u32>,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let right = bounds.position.x + bounds.size.width as i32;
    let bottom = bounds.position.y + bounds.size.height as i32;
    let collapsed_left = collapsed.position.x + safe_inset;
    let collapsed_top = collapsed.position.y + safe_inset;
    let collapsed_right = collapsed.position.x + collapsed.size.width as i32 - safe_inset;
    let collapsed_bottom = collapsed.position.y + collapsed.size.height as i32 - safe_inset;
    let x = match dock.horizontal {
        Some(HorizontalDock::Left) => collapsed_left - safe_inset,
        Some(HorizontalDock::Right) => collapsed_right - expanded_size.width as i32 + safe_inset,
        None if collapsed_left + expanded_size.width as i32 - safe_inset > right => {
            collapsed_right - expanded_size.width as i32 + safe_inset
        }
        None => collapsed_left - safe_inset,
    };
    let y = match dock.vertical {
        Some(VerticalDock::Top) => collapsed_top - safe_inset,
        Some(VerticalDock::Bottom) => collapsed_bottom - expanded_size.height as i32 + safe_inset,
        None if collapsed_top + expanded_size.height as i32 - safe_inset > bottom => {
            collapsed_bottom - expanded_size.height as i32 + safe_inset
        }
        None => collapsed_top - safe_inset,
    };
    clamp_position_to_bounds(
        PhysicalPosition::new(x, y),
        expanded_size,
        bounds,
        safe_inset,
    )
}

fn collapsed_geometry_for_expand(
    current_position: PhysicalPosition<i32>,
    collapsed_size: PhysicalSize<u32>,
    bounds: PhysicalRect<i32, u32>,
    threshold: i32,
    safe_inset: i32,
    previous: Option<WidgetGeometryState>,
) -> (WidgetRect, DockState) {
    if let Some(previous) = previous {
        let can_reuse_anchor = matches!(previous.mode, WidgetMode::Collapsed)
            || (matches!(previous.mode, WidgetMode::Expanded) && !previous.user_moved_expanded);
        if can_reuse_anchor {
            let position = if previous.dock.is_docked() {
                snap_position(
                    previous.collapsed_rect.position,
                    collapsed_size,
                    previous.dock,
                    bounds,
                    safe_inset,
                )
            } else {
                clamp_position_to_bounds(
                    previous.collapsed_rect.position,
                    collapsed_size,
                    bounds,
                    safe_inset,
                )
            };
            return (
                WidgetRect {
                    position,
                    size: collapsed_size,
                },
                previous.dock,
            );
        }
    }

    let current_collapsed = WidgetRect {
        position: clamp_position_to_bounds(current_position, collapsed_size, bounds, safe_inset),
        size: collapsed_size,
    };
    let dock = detect_dock(
        current_collapsed.position,
        collapsed_size,
        bounds,
        threshold,
        safe_inset,
    );
    let position = if dock.is_docked() {
        snap_position(
            current_collapsed.position,
            collapsed_size,
            dock,
            bounds,
            safe_inset,
        )
    } else {
        current_collapsed.position
    };
    (
        WidgetRect {
            position,
            size: collapsed_size,
        },
        dock,
    )
}

fn current_widget_rect(window: &tauri::WebviewWindow) -> Result<WidgetRect, String> {
    Ok(WidgetRect {
        position: window
            .outer_position()
            .map_err(|_| "failed to read widget position".to_string())?,
        size: window
            .outer_size()
            .map_err(|_| "failed to read widget size".to_string())?,
    })
}

fn monitor_and_scale(
    window: &tauri::WebviewWindow,
) -> Result<(Option<tauri::Monitor>, f64), String> {
    let monitor = window
        .current_monitor()
        .map_err(|_| "failed to read monitor".to_string())?;
    let scale_factor = monitor
        .as_ref()
        .map(tauri::Monitor::scale_factor)
        .unwrap_or(1.0);
    Ok((monitor, scale_factor))
}

fn infer_mode(rect: WidgetRect, collapsed_size: PhysicalSize<u32>) -> WidgetMode {
    if rect.size.width <= collapsed_size.width + POSITION_EPSILON
        && rect.size.height <= collapsed_size.height + POSITION_EPSILON
    {
        WidgetMode::Collapsed
    } else {
        WidgetMode::Expanded
    }
}

pub(crate) fn expand_widget(
    app: &AppHandle,
    controller: &GeometryController,
    work_area: Option<WorkAreaPayload>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor);
    let collapsed_size = collapsed_size(scale_factor, safe_inset);
    let expanded_size = expanded_size(scale_factor, safe_inset);
    let Some(monitor) = monitor else {
        return window
            .set_size(expanded_size)
            .map_err(|_| "failed to resize widget".to_string());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let previous = controller.geometry.lock().ok().and_then(|value| *value);
    let bounds = work_area
        .map(WorkAreaPayload::as_rect)
        .unwrap_or(*monitor.work_area());
    let (collapsed_rect, dock) = collapsed_geometry_for_expand(
        current.position,
        collapsed_size,
        bounds,
        threshold,
        safe_inset as i32,
        previous,
    );
    let expanded_rect = WidgetRect {
        position: expanded_position_in_bounds(
            collapsed_rect,
            expanded_size,
            dock,
            bounds,
            safe_inset as i32,
        ),
        size: expanded_size,
    };
    if let Ok(mut geometry) = controller.geometry.lock() {
        *geometry = Some(WidgetGeometryState {
            mode: WidgetMode::Expanded,
            dock,
            collapsed_rect,
            expanded_rect: Some(expanded_rect),
            user_moved_expanded: false,
        });
    }
    window
        .set_position(expanded_rect.position)
        .map_err(|_| "failed to position widget".to_string())?;
    window
        .set_size(expanded_size)
        .map_err(|_| "failed to resize widget".to_string())
}

pub(crate) fn collapse_widget(
    app: &AppHandle,
    controller: &GeometryController,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor);
    let collapsed_size = collapsed_size(scale_factor, safe_inset);
    let Some(monitor) = monitor else {
        return window
            .set_size(collapsed_size)
            .map_err(|_| "failed to resize widget".to_string());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let previous = controller.geometry.lock().ok().and_then(|value| *value);
    let user_moved_expanded = previous
        .map(|value| value.user_moved_expanded)
        .unwrap_or(false);
    let candidate = if user_moved_expanded {
        current.position
    } else {
        previous
            .map(|value| value.collapsed_rect.position)
            .unwrap_or(current.position)
    };
    let bounds = *monitor.work_area();
    let dock = detect_dock(
        candidate,
        collapsed_size,
        bounds,
        threshold,
        safe_inset as i32,
    );
    let next_position = if dock.is_docked() {
        snap_position(candidate, collapsed_size, dock, bounds, safe_inset as i32)
    } else {
        clamp_position_to_bounds(candidate, collapsed_size, bounds, safe_inset as i32)
    };
    if let Ok(mut geometry) = controller.geometry.lock() {
        *geometry = Some(WidgetGeometryState {
            mode: WidgetMode::Collapsed,
            dock,
            collapsed_rect: WidgetRect {
                position: next_position,
                size: collapsed_size,
            },
            expanded_rect: None,
            user_moved_expanded: false,
        });
    }
    window
        .set_size(collapsed_size)
        .map_err(|_| "failed to resize widget".to_string())?;
    window
        .set_position(next_position)
        .map_err(|_| "failed to position widget".to_string())
}

pub(crate) fn begin_widget_drag(
    app: &AppHandle,
    controller: &GeometryController,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (_, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor);
    let mode = controller
        .geometry
        .lock()
        .ok()
        .and_then(|value| *value)
        .map(|value| value.mode)
        .unwrap_or_else(|| infer_mode(current, collapsed_size(scale_factor, safe_inset)));
    if let Ok(mut drag_mode) = controller.drag_mode.lock() {
        *drag_mode = Some(mode);
    }
    Ok(())
}

pub(crate) fn finish_widget_drag(
    app: &AppHandle,
    controller: &GeometryController,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let safe_inset = logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor);
    let collapsed_size = collapsed_size(scale_factor, safe_inset);
    let expanded_size = expanded_size(scale_factor, safe_inset);
    let mode = controller
        .drag_mode
        .lock()
        .ok()
        .and_then(|mut value| value.take())
        .or_else(|| {
            controller
                .geometry
                .lock()
                .ok()
                .and_then(|value| *value)
                .map(|value| value.mode)
        })
        .unwrap_or_else(|| infer_mode(current, collapsed_size));

    match mode {
        WidgetMode::Collapsed => {
            let bounds = *monitor.work_area();
            let dock = detect_dock(
                current.position,
                collapsed_size,
                bounds,
                threshold,
                safe_inset as i32,
            );
            let next_position = if dock.is_docked() {
                snap_position(
                    current.position,
                    collapsed_size,
                    dock,
                    bounds,
                    safe_inset as i32,
                )
            } else {
                clamp_position_to_bounds(
                    current.position,
                    collapsed_size,
                    bounds,
                    safe_inset as i32,
                )
            };
            window
                .set_position(next_position)
                .map_err(|_| "failed to position widget".to_string())?;
            if let Ok(mut geometry) = controller.geometry.lock() {
                *geometry = Some(WidgetGeometryState {
                    mode: WidgetMode::Collapsed,
                    dock,
                    collapsed_rect: WidgetRect {
                        position: next_position,
                        size: collapsed_size,
                    },
                    expanded_rect: None,
                    user_moved_expanded: false,
                });
            }
        }
        WidgetMode::Expanded => {
            let current_position = clamp_position_to_bounds(
                current.position,
                expanded_size,
                *monitor.work_area(),
                safe_inset as i32,
            );
            window
                .set_position(current_position)
                .map_err(|_| "failed to position widget".to_string())?;
            if let Ok(mut geometry) = controller.geometry.lock() {
                if let Some(mut value) = *geometry {
                    value.mode = WidgetMode::Expanded;
                    value.expanded_rect = Some(WidgetRect {
                        position: current_position,
                        size: expanded_size,
                    });
                    value.user_moved_expanded = true;
                    *geometry = Some(value);
                }
            }
        }
    }
    Ok(())
}

fn intersects_visible_area(rect: WidgetRect, bounds: PhysicalRect<i32, u32>) -> bool {
    let rect_right = rect.position.x + rect.size.width as i32;
    let rect_bottom = rect.position.y + rect.size.height as i32;
    let bounds_right = bounds.position.x + bounds.size.width as i32;
    let bounds_bottom = bounds.position.y + bounds.size.height as i32;
    let width = rect_right.min(bounds_right) - rect.position.x.max(bounds.position.x);
    let height = rect_bottom.min(bounds_bottom) - rect.position.y.max(bounds.position.y);
    width >= 32 && height >= 32
}

pub(crate) fn ensure_widget_visible(
    app: &AppHandle,
    controller: &GeometryController,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let monitors = window
        .available_monitors()
        .map_err(|_| "failed to list monitors".to_string())?;
    if let Some(monitor) = monitors
        .iter()
        .find(|monitor| intersects_visible_area(current, *monitor.work_area()))
    {
        let safe_inset =
            logical_to_physical(EDGE_SAFE_INSET_LOGICAL, monitor.scale_factor()) as i32;
        let next_position = clamp_position_to_bounds(
            current.position,
            current.size,
            *monitor.work_area(),
            safe_inset,
        );
        if next_position != current.position {
            window
                .set_position(next_position)
                .map_err(|_| "failed to recover widget position".to_string())?;
            if let Ok(mut geometry) = controller.geometry.lock() {
                *geometry = None;
            }
        }
        return Ok(());
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next())
        .ok_or_else(|| "no monitor available".to_string())?;
    let scale_factor = monitor.scale_factor();
    let safe_inset = logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor) as i32;
    let next_position = clamp_position_to_bounds(
        current.position,
        current.size,
        *monitor.work_area(),
        safe_inset,
    );
    window
        .set_position(next_position)
        .map_err(|_| "failed to recover widget position".to_string())?;
    if let Ok(mut geometry) = controller.geometry.lock() {
        *geometry = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> WidgetRect {
        WidgetRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(width, height),
        }
    }

    #[test]
    fn window_sizes_include_the_transparent_safe_inset() {
        assert_eq!(window_dimension_for_visual_size(84.0, 1.0, 4), 92);
        assert_eq!(window_dimension_for_visual_size(328.0, 1.0, 4), 336);
        assert_eq!(window_dimension_for_visual_size(348.0, 1.0, 4), 356);
        assert_eq!(window_dimension_for_visual_size(328.0, 1.5, 6), 504);
    }

    #[test]
    fn collapsed_snap_stays_below_top_menu_bar() {
        let bounds = PhysicalRect {
            position: PhysicalPosition::new(0, 24),
            size: PhysicalSize::new(1920, 1056),
        };
        let size = PhysicalSize::new(92, 92);
        let dock = detect_dock(PhysicalPosition::new(100, 0), size, bounds, 24, 4);
        assert!(matches!(dock.vertical, Some(VerticalDock::Top)));
        assert_eq!(
            snap_position(PhysicalPosition::new(100, 0), size, dock, bounds, 4),
            PhysicalPosition::new(100, 20)
        );
    }

    #[test]
    fn collapsed_snap_stays_above_bottom_taskbar() {
        let bounds = PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(1920, 1040),
        };
        let size = PhysicalSize::new(92, 92);
        let dock = detect_dock(PhysicalPosition::new(100, 964), size, bounds, 24, 4);
        assert!(matches!(dock.vertical, Some(VerticalDock::Bottom)));
        assert_eq!(
            snap_position(PhysicalPosition::new(100, 964), size, dock, bounds, 4),
            PhysicalPosition::new(100, 952)
        );
    }

    #[test]
    fn expansion_stays_above_a_bottom_taskbar() {
        let position = expanded_position_in_bounds(
            rect(1824, 964, 92, 92),
            PhysicalSize::new(336, 356),
            DockState {
                horizontal: Some(HorizontalDock::Right),
                vertical: Some(VerticalDock::Bottom),
            },
            PhysicalRect {
                position: PhysicalPosition::new(0, 0),
                size: PhysicalSize::new(1920, 1040),
            },
            4,
        );
        assert_eq!(position, PhysicalPosition::new(1580, 688));
    }

    #[test]
    fn expansion_handles_negative_origin_work_areas() {
        let position = expanded_position_in_bounds(
            rect(-1284, -4, 92, 92),
            PhysicalSize::new(336, 356),
            DockState {
                horizontal: Some(HorizontalDock::Left),
                vertical: Some(VerticalDock::Top),
            },
            PhysicalRect {
                position: PhysicalPosition::new(-1280, 0),
                size: PhysicalSize::new(1280, 984),
            },
            4,
        );
        assert_eq!(position, PhysicalPosition::new(-1284, -4));
    }

    #[test]
    fn undocked_expansion_flips_inward_near_work_area_edges() {
        let position = expanded_position_in_bounds(
            rect(1750, 900, 92, 92),
            PhysicalSize::new(336, 356),
            DockState::default(),
            PhysicalRect {
                position: PhysicalPosition::new(0, 0),
                size: PhysicalSize::new(1920, 1040),
            },
            4,
        );
        assert_eq!(position, PhysicalPosition::new(1506, 636));
    }

    #[test]
    fn visible_intersection_accepts_negative_origin_monitors() {
        let bounds = PhysicalRect {
            position: PhysicalPosition::new(-1280, 0),
            size: PhysicalSize::new(1280, 984),
        };
        assert!(intersects_visible_area(rect(-40, 400, 92, 92), bounds));
        assert!(!intersects_visible_area(rect(40, 400, 92, 92), bounds));
    }
}
