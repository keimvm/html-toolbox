// 置いた・貼り付けたものを受け取れるツールが2つ以上あるとき、どれで何をするかを選んでもらう。
import { Button, Dialog } from '../ui/components';
import { Icon } from '../ui/icons';
import { choosing, deliverTo } from './deliver';

export function Chooser() {
  const state = choosing.value;
  return (
    <Dialog
      open={Boolean(state)}
      onClose={() => (choosing.value = null)}
      title={state?.title}
      class="chooser"
      initialFocus=".chooser-option"
    >
      {state && (
        <>
          <ul class="chooser-options">
            {state.options.map((option) => (
              <li key={`${option.tool.id}:${option.intent.id}`}>
                <button
                  type="button"
                  class="chooser-option"
                  onClick={() => deliverTo(option, state.input)}
                >
                  <img src={option.tool.icon} alt="" />
                  <span class="chooser-text">
                    <span class="chooser-label">{option.intent.label}</span>
                    <span class="chooser-detail">{option.intent.detail ?? option.tool.name}</span>
                  </span>
                  <Icon name="chevron-right" class="chooser-arrow" />
                </button>
              </li>
            ))}
          </ul>
          <div class="tb-dialog-actions">
            <Button onClick={() => (choosing.value = null)}>キャンセル</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
