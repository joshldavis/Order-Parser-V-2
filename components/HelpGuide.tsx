

import React from 'react';

// Fix: Make children optional to satisfy TS JSX attribute checking for wrapper components
const GuideSection = ({ title, icon, children }: { title: string, icon: string, children?: React.ReactNode }) => (
  <section className="mb-12">
    <div className="flex items-center gap-4 mb-6">
      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-xl shadow-sm">
        <i className={`fa-solid ${icon}`}></i>
      </div>
      <h2 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h2>
    </div>
    <div className="grid grid-cols-1 gap-6">
      {children}
    </div>
  </section>
);

const GuideCard = ({ step, label, title, description, tip }: { step?: number, label: string, title: string, description: string, tip?: string }) => (
  <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all group">
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        {step && (
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-[10px] font-black">
            {step}
          </div>
        )}
        <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{label}</span>
      </div>
    </div>
    <h3 className="text-xl font-black text-slate-900 mb-3 group-hover:text-indigo-600 transition-colors">{title}</h3>
    <p className="text-slate-500 text-sm leading-relaxed mb-4">{description}</p>
    {tip && (
      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start gap-3">
        <i className="fa-solid fa-lightbulb text-amber-500 mt-1"></i>
        <p className="text-[11px] font-bold text-slate-600 leading-normal">
          <span className="text-slate-900 uppercase tracking-tighter mr-1">Pro Tip:</span>
          {tip}
        </p>
      </div>
    )}
  </div>
);

export const HelpGuide: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto py-12 px-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="text-center mb-20">
        <h1 className="text-5xl font-black text-slate-900 tracking-tighter mb-4">OrderFlow <span className="text-indigo-600">Knowledge Base</span></h1>
        <p className="text-slate-500 text-lg font-medium max-w-2xl mx-auto">Master the configuration and operation of your enterprise document processing unit.</p>
      </div>

      <GuideSection title="Phase 1: Initial Calibration" icon="fa-wand-magic-sparkles">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GuideCard 
            step={1}
            label="Day 0 Task"
            title="The Validation Table"
            description="Upload a CSV containing historical AI predictions (confidence scores) vs. human corrections. This allows OrderFlow to compute the mathematical relationship between 'Confidence' and 'Accuracy'."
            tip="If you don't have historical data, you can skip this step and use our standard 92%/75% defaults."
          />
          <GuideCard 
            step={2}
            label="Logic"
            title="Calibrating the Gates"
            description="The system computes the Expected Calibration Error (ECE). This ensures that when the AI says it's '95% sure,' it's actually right 95% of the time. We use this to suggest threshold gates."
          />
        </div>
      </GuideSection>

      <GuideSection title="Phase 2: Resource Grounding" icon="fa-database">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GuideCard 
            step={3}
            label="Knowledge Base"
            title="Master Catalogue (XLSX)"
            description="Upload your product database. The AI uses this for 'Grounding'—it checks the text on the PDF against your actual Part Numbers, Finishes, and Manufacturers to ensure data integrity."
            tip="The AI can handle aliases. E.g., if your catalog says 'US26D' but the customer writes 'Satin Chrome', the Grounding Engine maps it correctly."
          />
          <GuideCard 
            step={4}
            label="Integration"
            title="Output Template"
            description="Mount your target ERP or Spreadsheet template. OrderFlow will map its extracted data directly into the columns required by your downstream systems (e.g., Sage, SAP)."
          />
        </div>
      </GuideSection>

      <GuideSection title="Phase 3: Operational Workflow" icon="fa-microchip">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <GuideCard 
            label="Ingestion"
            title="Document Import"
            description="Drag and drop PDFs or Images into the Parse tab. The system supports multi-document batches."
          />
          <GuideCard 
            label="Routing"
            title="Automation Lanes"
            description="Items are automatically routed into AUTO (Pass-through), REVIEW (Needs Check), or BLOCK (Invalid/Unsafe)."
          />
          <GuideCard 
            label="Sync"
            title="The Green Dot"
            description="The 'Sync Ready' indicator appears when a line item matches your catalog perfectly and has passed all policy checks."
          />
        </div>
      </GuideSection>

      <div className="bg-slate-900 rounded-[3rem] p-12 text-white relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full -mr-32 -mt-32 blur-3xl"></div>
        <h2 className="text-3xl font-black mb-8 flex items-center gap-4">
          <i className="fa-solid fa-circle-question text-indigo-400"></i>
          Frequently Asked Questions
        </h2>
        <div className="space-y-8">
          <div>
            <h4 className="text-indigo-300 font-black text-xs uppercase tracking-widest mb-2">What is a Confidence Score?</h4>
            <p className="text-slate-300 text-sm leading-relaxed">It's a value from 0-100 indicating the AI's certainty. We recommend an 'AUTO' gate of 92% to maintain high enterprise data standards.</p>
          </div>
          <div>
            <h4 className="text-indigo-300 font-black text-xs uppercase tracking-widest mb-2">Can the AI handle handwritten notes?</h4>
            <p className="text-slate-300 text-sm leading-relaxed">Yes. Our Tesseract OCR bridge extracts handwritten hints (like RGA numbers or Mark Instructions) before passing them to the Gemini reasoning engine.</p>
          </div>
          <div>
            <h4 className="text-indigo-300 font-black text-xs uppercase tracking-widest mb-2">How do I update the policy?</h4>
            <p className="text-slate-300 text-sm leading-relaxed">Use the Policy Admin tab to define 'Exclusion Rules'. For example, you can force all 'Credit Memos' to the REVIEW lane regardless of their confidence score.</p>
          </div>
        </div>
      </div>

      <div className="mt-12 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">
        OrderFlow Pro Version 2.5 • Enterprise Documentation
      </div>
    </div>
  );
};
