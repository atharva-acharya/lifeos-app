//! The main window works like a game client: one fixed 16:10 windowed size,
//! or maximised, and every page is laid out once for a 1440 x 900 canvas.
//! The webview zoom scales that canvas to whatever size the window has, so
//! the layout is the same on a laptop and on a large monitor.

use tauri::{LogicalSize, Manager, Runtime, WebviewWindow};

/// The size every page is designed for, in CSS pixels.
pub const CANVAS_WIDTH: f64 = 1440.0;
pub const CANVAS_HEIGHT: f64 = 900.0;

/// Share of the screen's usable area the windowed state covers.
const WINDOWED_SHARE: f64 = 0.8;

/// The windowed size for a screen work area, both in logical pixels:
/// 80% of the screen, at the canvas's 16:10 ratio.
pub fn windowed_size(work_width: f64, work_height: f64) -> (f64, f64) {
    let ratio = CANVAS_WIDTH / CANVAS_HEIGHT;
    let width = (work_width * WINDOWED_SHARE).min(work_height * WINDOWED_SHARE * ratio);
    (width.round(), (width / ratio).round())
}

/// The zoom that fits the 1440 x 900 canvas into a window of this logical
/// size. A wider or taller window keeps the canvas height or width and gives
/// the pages the extra room instead of side bars.
pub fn zoom_for(width: f64, height: f64) -> f64 {
    if width <= 0.0 || height <= 0.0 {
        return 1.0;
    }
    (width / CANVAS_WIDTH).min(height / CANVAS_HEIGHT)
}

/// Sizes the window for the screen it opens on, centres it, then shows it.
/// The window starts hidden so it never flashes at the wrong size.
pub fn place<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area().size.to_logical::<f64>(scale);
        let (width, height) = windowed_size(area.width, area.height);
        window.set_size(LogicalSize::new(width, height))?;
        window.center()?;
    }
    fit_zoom(window)?;
    window.show()
}

/// Matches the webview zoom to the window's current size.
pub fn fit_zoom<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    if size.width < 1.0 || size.height < 1.0 {
        // Minimised: keep the zoom the window had.
        return Ok(());
    }
    window.set_zoom(zoom_for(size.width, size.height))
}

/// Re-fits the zoom when the main window changes size (maximise, restore,
/// or moving to a screen with a different scale).
pub fn on_resized<R: Runtime>(window: &tauri::Window<R>) {
    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
        let _ = fit_zoom(&webview);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windowed_size_is_80_percent_at_16_by_10() {
        // A 2560 x 1440 monitor at 100%, minus a 48 px taskbar.
        assert_eq!(windowed_size(2560.0, 1392.0), (1782.0, 1114.0));
        // A laptop at 150%: 1707 x 1067 logical, minus the taskbar.
        assert_eq!(windowed_size(1707.0, 1019.0), (1304.0, 815.0));
        // A very wide screen is limited by its height.
        let (w, h) = windowed_size(3440.0, 1400.0);
        assert_eq!((w, h), (1792.0, 1120.0));
    }

    #[test]
    fn zoom_fits_the_canvas() {
        assert!((zoom_for(1440.0, 900.0) - 1.0).abs() < 1e-9);
        assert!((zoom_for(2880.0, 1800.0) - 2.0).abs() < 1e-9);
        // Maximised on a 16:9 screen: height decides, the extra width is room.
        assert!((zoom_for(2560.0, 1392.0) - 1392.0 / 900.0).abs() < 1e-9);
        assert!((zoom_for(0.0, 900.0) - 1.0).abs() < 1e-9);
    }
}
