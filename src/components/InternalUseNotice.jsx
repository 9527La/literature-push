import { ShieldCheck } from "lucide-react";


function InternalUseNotice({ className = "" }) {
  return (
    <aside className={`internal-use-notice ${className}`.trim()} role="note">
      <ShieldCheck size={18} aria-hidden="true" />
      <div>
        <strong>课题组内部使用</strong>
        <p>本项目只限于课题组内部使用，请勿外传，请勿用于商业用途。</p>
      </div>
    </aside>
  );
}

export default InternalUseNotice;
