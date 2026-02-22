'use client';

import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Center, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Home,
  Download,
  Eye,
  Box,
  Grid3x3,
  Loader2,
  Maximize,
  Plus,
  Minus,
  Move3d,
  Save,
  Edit,
  Trash2,
} from 'lucide-react';
import { BalloonDiagram, BalloonDiagramAnnotation } from '@/lib/api/project-reports';

interface BalloonDiagramViewerProps {
  diagram: BalloonDiagram;
  onAnnotationAdd?: (annotation: Omit<BalloonDiagramAnnotation, 'id' | 'bom_item'>) => void;
  onAnnotationUpdate?: (annotationId: string, annotation: Partial<BalloonDiagramAnnotation>) => void;
  onAnnotationDelete?: (annotationId: string) => void;
  onSaveDiagram?: (diagramData: any) => void;
  isEditing?: boolean;
}

interface AnnotationMarker {
  id: string;
  balloonNumber: number;
  position: [number, number, number];
  text?: string;
  bomItem?: {
    part_name: string;
    part_number: string;
    material: string;
    quantity: number;
  };
}

function BalloonAnnotation({ 
  annotation, 
  onEdit, 
  onDelete,
  isEditing 
}: { 
  annotation: AnnotationMarker; 
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  isEditing?: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <Html position={annotation.position} distanceFactor={20}>
      <div className="relative flex items-center justify-center">
        <div 
          className={`
            flex items-center justify-center w-8 h-8 rounded-full border-2 
            ${hover ? 'bg-blue-600 border-blue-400' : 'bg-blue-500 border-blue-300'}
            text-white font-bold text-sm shadow-lg cursor-pointer
            transition-all duration-200 hover:scale-110
          `}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => isEditing && onEdit?.(annotation.id)}
        >
          {annotation.balloonNumber}
        </div>
        
        {hover && (
          <Card className="absolute top-10 left-1/2 transform -translate-x-1/2 p-3 min-w-[200px] z-10 shadow-lg">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline">#{annotation.balloonNumber}</Badge>
                {isEditing && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit?.(annotation.id)}>
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete?.(annotation.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              {annotation.bomItem && (
                <div className="space-y-1 text-sm">
                  <div><strong>Part:</strong> {annotation.bomItem.part_name}</div>
                  <div><strong>Number:</strong> {annotation.bomItem.part_number}</div>
                  <div><strong>Material:</strong> {annotation.bomItem.material}</div>
                  <div><strong>Qty:</strong> {annotation.bomItem.quantity}</div>
                </div>
              )}
              {annotation.text && (
                <div className="text-sm text-gray-600">
                  {annotation.text}
                </div>
              )}
            </div>
          </Card>
        )}
        
        <svg 
          className="absolute top-8 left-4 pointer-events-none" 
          width="40" 
          height="40" 
          viewBox="0 0 40 40"
        >
          <path
            d="M 16 16 L 4 32"
            stroke={hover ? '#2563eb' : '#3b82f6'}
            strokeWidth="2"
            fill="none"
            markerEnd="url(#arrowhead)"
          />
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill={hover ? '#2563eb' : '#3b82f6'}
              />
            </marker>
          </defs>
        </svg>
      </div>
    </Html>
  );
}

function ModelViewer({ 
  fileUrl,
  annotations,
  onAnnotationAdd,
  onAnnotationEdit,
  onAnnotationDelete,
  isEditing 
}: {
  fileUrl: string;
  annotations: AnnotationMarker[];
  onAnnotationAdd?: (position: [number, number, number]) => void;
  onAnnotationEdit?: (id: string) => void;
  onAnnotationDelete?: (id: string) => void;
  isEditing?: boolean;
}) {
  const geometry = useLoader(STLLoader, fileUrl);
  const meshRef = useRef<THREE.Mesh>(null);
  const { raycaster, mouse, camera, gl } = useThree();

  const handleClick = useCallback((event: THREE.Event) => {
    if (!isEditing || !onAnnotationAdd) return;

    event.stopPropagation();
    
    if (event.intersections && event.intersections.length > 0) {
      const intersection = event.intersections[0];
      const worldPosition = intersection.point;
      onAnnotationAdd([worldPosition.x, worldPosition.y, worldPosition.z]);
    }
  }, [isEditing, onAnnotationAdd]);

  useEffect(() => {
    if (geometry) {
      geometry.computeBoundingBox();
      geometry.computeVertexNormals();
    }
  }, [geometry]);

  return (
    <Center>
      <mesh ref={meshRef} geometry={geometry} onClick={handleClick}>
        <meshStandardMaterial
          color="#e0e0e0"
          metalness={0.3}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {annotations.map((annotation) => (
        <BalloonAnnotation
          key={annotation.id}
          annotation={annotation}
          onEdit={onAnnotationEdit}
          onDelete={onAnnotationDelete}
          isEditing={isEditing}
        />
      ))}
    </Center>
  );
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center space-x-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading 3D model...</span>
      </div>
    </div>
  );
}

export default function BalloonDiagramViewer({
  diagram,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationDelete,
  onSaveDiagram,
  isEditing = false,
}: BalloonDiagramViewerProps) {
  const [cameraDistance, setCameraDistance] = useState(100);
  const [view, setView] = useState<'home' | 'front' | 'back' | 'top' | 'bottom' | 'right' | 'left' | 'isometric'>('home');
  const [showGrid, setShowGrid] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [newAnnotationData, setNewAnnotationData] = useState({
    balloonNumber: 1,
    text: '',
    bomItemId: '',
  });

  const cameraPositions = getCADViews(cameraDistance);

  const annotations: AnnotationMarker[] = diagram.annotations?.map((ann) => ({
    id: ann.id,
    balloonNumber: ann.balloon_number,
    position: [ann.position_x, ann.position_y, ann.position_z || 0],
    text: ann.annotation_text,
    bomItem: ann.bom_item,
  })) || [];

  const handleAddAnnotation = useCallback((position: [number, number, number]) => {
    if (!onAnnotationAdd) return;

    const newAnnotation = {
      bom_item_id: newAnnotationData.bomItemId || 'temp-id',
      balloon_number: Math.max(...annotations.map(a => a.balloonNumber), 0) + 1,
      position_x: position[0],
      position_y: position[1],
      position_z: position[2],
      annotation_text: newAnnotationData.text,
    };

    onAnnotationAdd(newAnnotation);
  }, [onAnnotationAdd, annotations, newAnnotationData]);

  const handleEditAnnotation = useCallback((id: string) => {
    setSelectedAnnotation(id);
  }, []);

  const handleDeleteAnnotation = useCallback((id: string) => {
    if (onAnnotationDelete) {
      onAnnotationDelete(id);
    }
  }, [onAnnotationDelete]);

  const handleSave = useCallback(() => {
    if (onSaveDiagram) {
      const diagramData = {
        annotations,
        cameraSettings: {
          distance: cameraDistance,
          view,
        },
        displaySettings: {
          showGrid,
          showWireframe,
        },
      };
      onSaveDiagram(diagramData);
    }
  }, [onSaveDiagram, annotations, cameraDistance, view, showGrid, showWireframe]);

  if (!diagram.cad_file_path) {
    return (
      <Card className="p-8 text-center">
        <Box className="h-12 w-12 mx-auto mb-4 text-gray-400" />
        <h3 className="text-lg font-semibold mb-2">No CAD File</h3>
        <p className="text-gray-600">Upload a CAD file to create a balloon diagram</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-semibold">{diagram.name}</h3>
          <Badge variant="outline">{annotations.length} Annotations</Badge>
        </div>
        
        <div className="flex items-center space-x-2">
          {isEditing && (
            <Button onClick={handleSave} size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          )}
          
          <Button variant="outline" size="sm" onClick={() => setView('home')}>
            <Home className="h-4 w-4" />
          </Button>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowGrid(!showGrid)}
            data-active={showGrid}
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowWireframe(!showWireframe)}
            data-active={showWireframe}
          >
            <Eye className="h-4 w-4" />
          </Button>
          
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1">
        <div className="flex-1 relative">
          <Canvas shadows>
            <Suspense fallback={<LoadingFallback />}>
              <PerspectiveCamera 
                makeDefault 
                position={cameraPositions[view].position} 
                fov={45}
              />
              
              <OrbitControls 
                enablePan={true}
                enableZoom={true}
                enableRotate={true}
                maxPolarAngle={Math.PI}
                minDistance={10}
                maxDistance={1000}
              />

              <ambientLight intensity={0.4} />
              <directionalLight
                position={[10, 10, 5]}
                intensity={0.8}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              />
              <directionalLight
                position={[-10, -10, -5]}
                intensity={0.3}
              />

              {showGrid && <Grid infiniteGrid size={100} />}
              
              <ModelViewer
                fileUrl={diagram.cad_file_path}
                annotations={annotations}
                onAnnotationAdd={isEditing ? handleAddAnnotation : undefined}
                onAnnotationEdit={isEditing ? handleEditAnnotation : undefined}
                onAnnotationDelete={isEditing ? handleDeleteAnnotation : undefined}
                isEditing={isEditing}
              />
            </Suspense>
          </Canvas>
        </div>

        {isEditing && (
          <Card className="w-80 p-4 border-l">
            <div className="space-y-4">
              <h4 className="font-semibold">Annotation Tools</h4>
              
              <div className="space-y-2">
                <Label htmlFor="balloonNumber">Next Balloon Number</Label>
                <Input
                  id="balloonNumber"
                  type="number"
                  value={newAnnotationData.balloonNumber}
                  onChange={(e) => setNewAnnotationData(prev => ({
                    ...prev,
                    balloonNumber: parseInt(e.target.value) || 1
                  }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="annotationText">Annotation Text</Label>
                <Input
                  id="annotationText"
                  value={newAnnotationData.text}
                  onChange={(e) => setNewAnnotationData(prev => ({
                    ...prev,
                    text: e.target.value
                  }))}
                  placeholder="Optional description"
                />
              </div>
              
              <div className="text-sm text-gray-600">
                <p>Click on the 3D model to place annotations</p>
                <p>Hover over balloons to see details</p>
              </div>
              
              <div className="space-y-2">
                <h5 className="font-medium">Existing Annotations</h5>
                {annotations.map((annotation) => (
                  <div 
                    key={annotation.id}
                    className="flex items-center justify-between p-2 border rounded"
                  >
                    <span>#{annotation.balloonNumber}</span>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handleDeleteAnnotation(annotation.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

const getCADViews = (distance: number) => ({
  home: { position: [distance, distance, distance] as [number, number, number], name: 'Home' },
  front: { position: [0, 0, distance] as [number, number, number], name: 'Front' },
  back: { position: [0, 0, -distance] as [number, number, number], name: 'Back' },
  top: { position: [0, distance, 0] as [number, number, number], name: 'Top' },
  bottom: { position: [0, -distance, 0] as [number, number, number], name: 'Bottom' },
  right: { position: [distance, 0, 0] as [number, number, number], name: 'Right' },
  left: { position: [-distance, 0, 0] as [number, number, number], name: 'Left' },
  isometric: { position: [distance, distance, distance] as [number, number, number], name: 'Isometric' },
});