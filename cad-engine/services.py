"""
STEP to STL Conversion Services

Refactored with SOLID principles and dependency injection
"""

import os
import logging
from typing import Optional
from pathlib import Path

from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.StlAPI import StlAPI_Writer
from OCC.Core.TopoDS import TopoDS_Shape

from exceptions import StepReadError, MeshingError, StlWriteError, ConversionError


logger = logging.getLogger(__name__)


class StepReader:
    """
    Reads STEP files and converts to TopoDS_Shape
    
    Single Responsibility: Only handles STEP file reading
    """
    
    def read(self, step_file_path: str) -> TopoDS_Shape:
        """
        Read STEP file and return shape
        
        Args:
            step_file_path: Path to STEP file
            
        Returns:
            TopoDS_Shape object
            
        Raises:
            StepReadError: If reading fails
        """
        try:
            logger.info(f"Reading STEP file: {step_file_path}")
            
            # Verify file exists
            if not os.path.exists(step_file_path):
                raise StepReadError(f"STEP file does not exist: {step_file_path}")
            
            file_size = os.path.getsize(step_file_path)
            logger.info(f"STEP file size: {file_size} bytes")
            
            # Create STEP reader
            reader = STEPControl_Reader()
            
            # Read file
            status = reader.ReadFile(step_file_path)
            logger.info(f"STEP read status: {status}")
            
            if status != IFSelect_RetDone:
                raise StepReadError(f"Failed to read STEP file, status code: {status}")
            
            # Transfer roots to document
            logger.info("Transferring roots...")
            nb_roots = reader.TransferRoots()
            logger.info(f"Transferred {nb_roots} roots")
            
            # Get shape
            shape = reader.OneShape()
            
            if shape.IsNull():
                raise StepReadError("STEP file contains no valid shapes")
            
            logger.info(f"Successfully read STEP file - Shape type: {shape.ShapeType()}")
            return shape
        
        except StepReadError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error reading STEP file: {str(e)}", exc_info=True)
            raise StepReadError(f"Error reading STEP file: {str(e)}")


class ShapeMesher:
    """
    Creates triangular mesh from B-Rep shapes
    
    Single Responsibility: Only handles meshing operations
    """
    
    def __init__(self, linear_deflection: float, angular_deflection: float):
        """
        Initialize mesher with quality settings
        
        Args:
            linear_deflection: Mesh linear deflection (smaller = higher quality)
            angular_deflection: Mesh angular deflection in radians
        """
        self.linear_deflection = linear_deflection
        self.angular_deflection = angular_deflection
        logger.info(
            f"ShapeMesher initialized (linear: {linear_deflection}, "
            f"angular: {angular_deflection})"
        )
    
    def mesh(self, shape: TopoDS_Shape) -> TopoDS_Shape:
        """
        Create triangular mesh from B-Rep shape
        
        Args:
            shape: TopoDS_Shape to mesh
            
        Returns:
            Meshed TopoDS_Shape
            
        Raises:
            MeshingError: If meshing fails
        """
        try:
            logger.info("Meshing shape...")
            
            # Create incremental mesh
            mesh = BRepMesh_IncrementalMesh(
                shape,
                self.linear_deflection,
                False,  # Not relative
                self.angular_deflection,
                True    # In parallel
            )
            
            mesh.Perform()
            
            if not mesh.IsDone():
                raise MeshingError("Meshing operation failed")
            
            logger.info("Meshing completed successfully")
            return shape
        
        except MeshingError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error during meshing: {str(e)}", exc_info=True)
            raise MeshingError(f"Error meshing shape: {str(e)}")


class StlWriter:
    """
    Writes TopoDS_Shape to STL file
    
    Single Responsibility: Only handles STL file writing
    """
    
    def __init__(self, ascii_mode: bool = False):
        """
        Initialize STL writer
        
        Args:
            ascii_mode: If True, write ASCII STL; if False, write binary STL
        """
        self.ascii_mode = ascii_mode
        logger.info(f"StlWriter initialized (ASCII mode: {ascii_mode})")
    
    def write(self, shape: TopoDS_Shape, stl_file_path: str):
        """
        Write shape to binary STL file.

        Returns:
            Tuple (stl_file_path, stl_tri_count) — the triangle count from the STL header
            is used to verify face_map ordering (compare with face_map_tri_total from
            /analyze/geometry).  If the two counts match, StlAPI_Writer uses the same
            TopExp_Explorer face order as our walk in memory_optimizer.py.

        Raises:
            StlWriteError: If writing fails
        """
        import struct as _struct

        try:
            logger.info(f"Writing STL file: {stl_file_path}")

            # Create STL writer
            stl_writer = StlAPI_Writer()
            stl_writer.SetASCIIMode(self.ascii_mode)

            # Write to file
            stl_writer.Write(shape, stl_file_path)

            # Verify file was created
            if not os.path.exists(stl_file_path):
                raise StlWriteError("STL file was not created")

            file_size = os.path.getsize(stl_file_path)

            # Read triangle count from binary STL header for ordering verification.
            # Binary STL: 80-byte header + uint32 triangle count + 50 bytes per triangle.
            # Compare this value to face_map_tri_total from /analyze/geometry:
            #   equal  → StlAPI_Writer uses same TopExp_Explorer order → face_map is valid
            #   unequal → implement write_with_face_map() deterministic export instead
            stl_tri_count: int = 0
            try:
                with open(stl_file_path, 'rb') as _f:
                    _f.seek(80)
                    stl_tri_count = _struct.unpack('<I', _f.read(4))[0]
                logger.info(
                    f"STL written: {file_size} bytes, {stl_tri_count} triangles "
                    f"[compare with face_map_tri_total from /analyze/geometry to verify ordering]"
                )
            except Exception as _e:
                logger.warning(f"Could not read STL header triangle count: {_e}")

            return stl_file_path, stl_tri_count

        except StlWriteError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error writing STL file: {str(e)}", exc_info=True)
            raise StlWriteError(f"Error writing STL file: {str(e)}")


class ConversionService:
    """
    Orchestrates the complete STEP to STL conversion pipeline
    
    Dependency Injection: Receives all dependencies via constructor
    """
    
    def __init__(
        self,
        step_reader: StepReader,
        shape_mesher: ShapeMesher,
        stl_writer: StlWriter
    ):
        """
        Initialize conversion service with dependencies
        
        Args:
            step_reader: STEP file reader
            shape_mesher: Shape meshing service
            stl_writer: STL file writer
        """
        self.step_reader = step_reader
        self.shape_mesher = shape_mesher
        self.stl_writer = stl_writer
        logger.info("ConversionService initialized")
    
    def convert(self, step_file_path: str, stl_file_path: str):
        """
        Complete conversion pipeline: STEP → STL
        
        Args:
            step_file_path: Input STEP file
            stl_file_path: Output STL file
            
        Returns:
            Path to output STL file
            
        Raises:
            ConversionError: If any step in the pipeline fails
        """
        logger.info(f"Starting conversion: {step_file_path} → {stl_file_path}")
        
        try:
            # Step 1: Read STEP file
            shape = self.step_reader.read(step_file_path)
            
            # Step 2: Mesh the shape
            meshed_shape = self.shape_mesher.mesh(shape)
            
            # Step 3: Write STL file (returns (path, stl_tri_count) tuple)
            output_path, stl_tri_count = self.stl_writer.write(meshed_shape, stl_file_path)

            logger.info(f"Conversion completed successfully (STL triangles: {stl_tri_count})")
            return output_path, stl_tri_count
        
        except (StepReadError, MeshingError, StlWriteError) as e:
            logger.error(f"Conversion failed: {str(e)}")
            raise ConversionError(f"Conversion failed: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected conversion error: {str(e)}", exc_info=True)
            raise ConversionError(f"Unexpected error during conversion: {str(e)}")
