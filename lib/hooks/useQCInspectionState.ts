import { useState, useCallback, useMemo } from 'react';

interface InspectionState {
  currentInspection: any | null;
  showReportDialog: boolean;
  showReportView: boolean;
  selectedInspection: any | null;
}

interface InspectionActions {
  setCurrentInspection: (inspection: any | null) => void;
  setShowReportDialog: (show: boolean) => void;
  setShowReportView: (show: boolean) => void;
  setSelectedInspection: (inspection: any | null) => void;
  openReportDialog: (inspection: any) => void;
  closeReportDialog: () => void;
  openReportView: (inspection: any) => void;
  closeReportView: () => void;
  reset: () => void;
}

const initialState: InspectionState = {
  currentInspection: null,
  showReportDialog: false,
  showReportView: false,
  selectedInspection: null,
};

export function useQCInspectionState() {
  const [state, setState] = useState<InspectionState>(initialState);

  const actions = useMemo<InspectionActions>(() => ({
    setCurrentInspection: (inspection) => {
      setState(prev => ({ ...prev, currentInspection: inspection }));
    },
    
    setShowReportDialog: (show) => {
      setState(prev => ({ ...prev, showReportDialog: show }));
    },
    
    setShowReportView: (show) => {
      setState(prev => ({ ...prev, showReportView: show }));
    },
    
    setSelectedInspection: (inspection) => {
      setState(prev => ({ ...prev, selectedInspection: inspection }));
    },
    
    openReportDialog: (inspection) => {
      setState(prev => ({
        ...prev,
        currentInspection: inspection,
        showReportDialog: true,
      }));
    },
    
    closeReportDialog: () => {
      setState(prev => ({
        ...prev,
        showReportDialog: false,
        currentInspection: null,
      }));
    },
    
    openReportView: (inspection) => {
      setState(prev => ({
        ...prev,
        selectedInspection: inspection,
        showReportView: true,
      }));
    },
    
    closeReportView: () => {
      setState(prev => ({
        ...prev,
        showReportView: false,
        selectedInspection: null,
      }));
    },
    
    reset: () => {
      setState(initialState);
    },
  }), []);

  return {
    state,
    actions,
  };
}