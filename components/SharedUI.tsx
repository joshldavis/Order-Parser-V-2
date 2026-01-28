import React from 'react';

interface TooltipProps {
  children?: React.ReactNode;
  position?: 'top' | 'bottom' | 'left';
  align?: 'center' | 'left' | 'right';
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  children, 
  position = 'bottom', 
  align = 'center', 
  className = '' 
}) => {
  const alignClasses = {
    center: 'left-1/2 -translate-x-1/2',
    left: 'left-0 translate-x-0',
    right: 'right-0 translate-x-0'
  };

  const positionClasses = {
    top: `bottom-full mb-3 ${alignClasses[align]}`,
    bottom: `top-full mt-3 ${alignClasses[align]}`,
    left: 'right-full mr-3 top-0'
  };

  const arrowClasses = {
    top: `top-full ${align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'left' ? 'left-4' : 'right-4'} border-t-slate-900`,
    bottom: `bottom-full ${align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'left' ? 'left-4' : 'right-4'} border-b-slate-900`,
    left: 'left-full top-2 border-l-slate-900'
  };

  return (
    <div className={`absolute ${positionClasses[position]} hidden group-hover:block w-72 p-4 bg-slate-900 text-white text-[11px] leading-relaxed tracking-tight font-medium rounded-2xl shadow-2xl z-[100] pointer-events-none border border-white/10 backdrop-blur-xl whitespace-normal text-left ${className}`}>
      {children}
      <div className={`absolute border-8 border-transparent ${arrowClasses[position]}`}></div>
    </div>
  );
};

interface HeaderInfoProps {
  title: string;
  description: string;
  details?: string[];
  align?: 'center' | 'left' | 'right';
}

export const HeaderInfo: React.FC<HeaderInfoProps> = ({ 
  title, 
  description, 
  details, 
  align = 'center' 
}) => (
  <div className="group relative inline-flex items-center ml-2 cursor-help align-middle">
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-200/50 group-hover:bg-blue-100 transition-all duration-300">
      <i className="fa-solid fa-info text-[9px] text-slate-500 group-hover:text-blue-600"></i>
    </div>
    <Tooltip position="bottom" align={align} className="ring-1 ring-white/20">
      <div className="mb-2 pb-2 border-b border-white/10">
        <h4 className="text-blue-400 font-black uppercase tracking-widest text-[10px]">{title}</h4>
      </div>
      <p className="text-slate-200 mb-3">{description}</p>
      {details && details.length > 0 && (
        <ul className="space-y-1.5">
          {details.map((d, i) => (
            <li key={i} className="flex gap-2 text-slate-400">
              <span className="text-blue-500">•</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
    </Tooltip>
  </div>
);