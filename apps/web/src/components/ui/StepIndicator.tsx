interface StepIndicatorProps {
  totalSteps: number;
  currentStep: number; // 0-indexed
}

export function StepIndicator({ totalSteps, currentStep }: StepIndicatorProps) {
  return (
    <div className="mb-6 flex items-center gap-2 px-6">
      {Array.from({ length: totalSteps }).map((_, i) => (
        <div key={i} className="flex flex-1 items-center gap-2">
          <div
            className={`h-2 rounded-full transition-all ${
              i < currentStep
                ? 'w-2 bg-gray-950'
                : i === currentStep
                  ? 'w-6 bg-red-600'
                  : 'w-2 bg-gray-300'
            }`}
          />
          {i < totalSteps - 1 && <div className="h-[2px] flex-1 bg-gray-200" />}
        </div>
      ))}
    </div>
  );
}
