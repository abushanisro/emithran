'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSubmitKbFeedback } from '@/lib/api/hooks/useManufacturingKnowledge';
import { cn } from '@/lib/utils';

interface Props {
  bomItemId: string;
  partFamily?: string;
  aiProcessSequence: string[];
  aiMachines?: Record<string, string>;
  onClose: () => void;
}

export function ProcessPlanFeedbackForm({
  bomItemId,
  partFamily,
  aiProcessSequence,
  aiMachines,
  onClose,
}: Props) {
  const [correctedSequence, setCorrectedSequence] = useState(
    aiProcessSequence.join('\n'),
  );
  const [correctionReason, setCorrectionReason] = useState('');

  const submitFeedback = useSubmitKbFeedback();

  function handleSubmit() {
    const engineerSequence = correctedSequence
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    submitFeedback.mutate(
      {
        bomItemId,
        aiProcessSequence,
        aiMachines,
        engineerSequence,
        correctionReason: correctionReason.trim() || undefined,
        partFamily,
      },
      {
        onSuccess: () => {
          toast.success('Feedback submitted — thank you for improving the system');
          onClose();
        },
        onError: () => {
          toast.error('Failed to submit feedback');
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Submit Engineer Correction</h3>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">AI Generated Sequence</Label>
        <ol className="list-decimal list-inside space-y-1">
          {aiProcessSequence.map((step, i) => (
            <li key={i} className="text-sm">
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <Label htmlFor="corrected-sequence">Corrected Sequence</Label>
        <Textarea
          id="corrected-sequence"
          value={correctedSequence}
          onChange={(e) => setCorrectedSequence(e.target.value)}
          rows={Math.max(4, aiProcessSequence.length + 1)}
          placeholder="One process per line. Edit the order or add/remove steps."
          className={cn('font-mono text-sm')}
        />
        <p className="text-xs text-muted-foreground">
          One process per line. Edit the order or add/remove steps.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="correction-reason">
          Correction Reason{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="correction-reason"
          value={correctionReason}
          onChange={(e) => setCorrectionReason(e.target.value)}
          rows={3}
          placeholder="Why did the AI get this wrong?"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitFeedback.isPending}
        className="w-full"
      >
        {submitFeedback.isPending ? 'Submitting…' : 'Submit Correction'}
      </Button>
    </div>
  );
}
