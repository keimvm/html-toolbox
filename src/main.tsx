// toolbox の起動。保存した配色を最初に反映してから、画面を作る。
import './ui/theme.css';
import './app/app.css';
import { render } from 'preact';
import { App } from './app/App';
import { applyTheme } from './lib/theme';

applyTheme();
render(<App />, document.getElementById('app')!);
