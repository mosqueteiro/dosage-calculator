/**
 * Application entry point.
 */
import { initCalculator } from './ui/calculator.js';
import { initPresets } from './ui/presets.js';
import { initHistory } from './ui/history.js';
import { initSettings } from './ui/settings.js';

const controller = initCalculator();
initPresets(controller);
initHistory(controller);
initSettings(controller);
