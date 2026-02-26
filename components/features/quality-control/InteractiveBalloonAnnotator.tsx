'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBalloonAnnotations, type Balloon } from '@/lib/hooks/useBalloonAnnotations';
import { 
  Plus, 
  Minus, 
  RotateCw, 
  Download, 
  Save, 
  Undo, 
  Redo, 
  Trash2,
  MousePointer,
  Circle,
  Edit,
  X,
  Loader2
} from 'lucide-react';

interface InteractiveBalloonAnnotatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string;
  fileName: string;
  fileId: string;
  onSave?: (balloons: Balloon[]) => void;
}

export default function InteractiveBalloonAnnotator({
  open,
  onOpenChange,
  pdfUrl,
  fileName,
  fileId,
  onSave
}: InteractiveBalloonAnnotatorProps) {
  const {
    balloons,
    loading: savingLoading,
    error: saveError,
    loadBalloons,
    saveBalloons,
    setBalloons
  } = useBalloonAnnotations({ fileId, autoLoad: true });

  const [nextBalloonNumber, setNextBalloonNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [isAnnotating, setIsAnnotating] = useState(true);
  const [selectedBalloon, setSelectedBalloon] = useState<string | null>(null);
  const [history, setHistory] = useState<Balloon[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Update next balloon number when balloons change
  useEffect(() => {
    const maxNumber = balloons.reduce((max, balloon) => Math.max(max, balloon.number), 0);
    setNextBalloonNumber(maxNumber + 1);
  }, [balloons]);

  // Save to history
  const saveToHistory = useCallback((newBalloons: Balloon[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newBalloons);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Handle click on PDF container
  const handleContainerClick = useCallback((event: React.MouseEvent) => {
    if (!isAnnotating || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / scale);
    const y = ((event.clientY - rect.top) / scale);

    const newBalloon: Balloon = {
      id: `balloon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      number: nextBalloonNumber,
      x,
      y,
      timestamp: Date.now()
    };

    const newBalloons = [...balloons, newBalloon];
    setBalloons(newBalloons);
    saveToHistory(newBalloons);
  }, [isAnnotating, scale, nextBalloonNumber, balloons, saveToHistory]);

  // Delete balloon
  const deleteBalloon = useCallback((balloonId: string) => {
    const newBalloons = balloons.filter(b => b.id !== balloonId);
    setBalloons(newBalloons);
    saveToHistory(newBalloons);
    setSelectedBalloon(null);
  }, [balloons, saveToHistory]);

  // Undo/Redo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setBalloons(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setBalloons(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // Clear all balloons
  const clearAllBalloons = useCallback(() => {
    setBalloons([]);
    saveToHistory([]);
  }, [saveToHistory]);

  // Save balloons
  const handleSave = useCallback(async () => {
    try {
      await saveBalloons(balloons);
      if (onSave) {
        onSave(balloons);
      }
    } catch (error) {
      console.error('Failed to save balloons:', error);
    }
  }, [balloons, saveBalloons, onSave]);

  // Zoom controls
  const zoomIn = () => setScale(prev => Math.min(prev + 0.25, 3));
  const zoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.5));
  const resetZoom = () => setScale(1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Circle className="h-6 w-6 text-blue-600" />
              Interactive Balloon Annotation
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600 mt-1">
              Click on the PDF to add numbered balloons • {balloons.length} balloon(s) added
            </DialogDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Toolbar */}
        <div className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Annotation Mode Toggle */}
              <Button
                variant={isAnnotating ? "default" : "outline"}
                size="sm"
                onClick={() => setIsAnnotating(!isAnnotating)}
                className="flex items-center gap-1"
              >
                {isAnnotating ? <Circle className="h-4 w-4" /> : <MousePointer className="h-4 w-4" />}
                {isAnnotating ? 'Add Balloons' : 'Select Mode'}
              </Button>

              <div className="w-px h-6 bg-gray-300" />

              {/* Zoom Controls */}
              <Button variant="outline" size="sm" onClick={zoomOut}>
                <Minus className="h-4 w-4" />
              </Button>
              <Badge variant="outline" className="px-2">
                {Math.round(scale * 100)}%
              </Badge>
              <Button variant="outline" size="sm" onClick={zoomIn}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={resetZoom}>
                Reset
              </Button>

              <div className="w-px h-6 bg-gray-300" />

              {/* History Controls */}
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={historyIndex <= 0}
              >
                <Undo className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* Next Balloon Number */}
              <Badge className="bg-red-100 text-red-800">
                Next: {nextBalloonNumber}
              </Badge>

              {/* Action Buttons */}
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllBalloons}
                disabled={balloons.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={balloons.length === 0 || savingLoading}
              >
                {savingLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                {savingLoading ? 'Saving...' : 'Save Balloons'}
              </Button>
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-2 text-sm text-gray-600">
            {isAnnotating ? (
              <p>✨ Click anywhere on the PDF to add balloon number {nextBalloonNumber}</p>
            ) : (
              <p>👆 Click on a balloon to select and edit it</p>
            )}
          </div>
        </div>

        {/* PDF Container with Balloons */}
        <div className="flex-1 flex gap-4 min-h-[600px]">
          {/* Main PDF Area */}
          <div className="flex-1">
            <div
              ref={containerRef}
              className="relative border border-gray-300 rounded-lg overflow-auto bg-gray-100 cursor-crosshair"
              style={{ 
                height: '600px',
                cursor: isAnnotating ? 'crosshair' : 'default'
              }}
              onClick={handleContainerClick}
            >
              {/* PDF Iframe */}
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  width: `${100 / scale}%`,
                  height: `${100 / scale}%`
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={pdfUrl}
                  className="w-full h-full border-0"
                  style={{ pointerEvents: isAnnotating ? 'none' : 'auto' }}
                />
              </div>

              {/* Connecting Lines */}
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{
                  width: `${100 * scale}%`,
                  height: `${100 * scale}%`,
                  transform: `scale(${1 / scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {balloons
                  .sort((a, b) => a.number - b.number)
                  .map((balloon, index, sortedBalloons) => {
                    if (index === sortedBalloons.length - 1) return null;
                    const nextBalloon = sortedBalloons[index + 1];
                    return (
                      <line
                        key={`line-${balloon.id}-${nextBalloon.id}`}
                        x1={balloon.x}
                        y1={balloon.y}
                        x2={nextBalloon.x}
                        y2={nextBalloon.y}
                        stroke="#dc2626"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        opacity="0.7"
                      />
                    );
                  })}
              </svg>

              {/* Balloon Overlays */}
              {balloons.map((balloon) => (
                <div
                  key={balloon.id}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all ${
                    selectedBalloon === balloon.id 
                      ? 'ring-4 ring-red-500 ring-opacity-50' 
                      : ''
                  }`}
                  style={{
                    left: balloon.x * scale,
                    top: balloon.y * scale,
                    zIndex: selectedBalloon === balloon.id ? 20 : 10
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBalloon(balloon.id);
                  }}
                >
                  {/* Balloon Circle */}
                  <div className="relative">
                    <div 
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold shadow-lg transition-all ${
                        selectedBalloon === balloon.id
                          ? 'bg-red-600 border-red-700 text-white scale-110'
                          : 'bg-red-500 border-red-700 text-white hover:bg-red-600'
                      }`}
                    >
                      {balloon.number}
                    </div>
                    
                    {/* Delete button for selected balloon */}
                    {selectedBalloon === balloon.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBalloon(balloon.id);
                        }}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs hover:bg-gray-900"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Click instruction overlay when no balloons */}
              {balloons.length === 0 && isAnnotating && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-white bg-opacity-90 rounded-lg p-6 text-center border border-gray-200 shadow-lg">
                    <Circle className="h-12 w-12 text-red-500 mx-auto mb-2" />
                    <p className="text-lg font-semibold text-gray-800 mb-1">Start Adding Balloons</p>
                    <p className="text-sm text-gray-600">Click anywhere on the PDF to place red balloon #1</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Balloon List Sidebar */}
          <div className="w-64 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Circle className="h-5 w-5" />
                  Balloons ({balloons.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {balloons.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    <p className="text-sm">No balloons added yet</p>
                    <p className="text-xs text-gray-400 mt-1">Click on the PDF to add some</p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {balloons
                      .sort((a, b) => a.number - b.number)
                      .map((balloon) => (
                        <div
                          key={balloon.id}
                          className={`flex items-center justify-between p-2 rounded border cursor-pointer transition-colors ${
                            selectedBalloon === balloon.id
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          }`}
                          onClick={() => setSelectedBalloon(balloon.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-red-500 border border-red-700 flex items-center justify-center text-xs font-bold text-white">
                              {balloon.number}
                            </div>
                            <div>
                              <p className="text-sm font-medium">Balloon {balloon.number}</p>
                              <p className="text-xs text-gray-500">
                                ({Math.round(balloon.x)}, {Math.round(balloon.y)})
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBalloon(balloon.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* File Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">File Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-gray-600">File Name</p>
                  <p className="text-sm break-all">{fileName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Zoom Level</p>
                  <p className="text-sm">{Math.round(scale * 100)}%</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600">Total Balloons</p>
                  <p className="text-sm">{balloons.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}