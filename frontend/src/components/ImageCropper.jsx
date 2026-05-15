import React, { useState, useRef } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Button } from './ui/Button';
import { UploadCloud, Scissors, Check } from 'lucide-react';

// Función para obtener la imagen recortada
function getCroppedImg(image, crop, fileName) {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    crop.width,
    crop.height
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        console.error('Canvas is empty');
        return;
      }
      blob.name = fileName;
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        // Devolver solo la parte base64
        resolve(reader.result.split(',')[1]);
      };
    }, 'image/png');
  });
}

export function ImageCropper({ onCropComplete }) {
  const [imgSrc, setImgSrc] = useState('');
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState();
  const [originalFile, setOriginalFile] = useState(null);
  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  const onSelectFile = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setCrop(undefined); // Resetear crop al seleccionar nuevo archivo
      const reader = new FileReader();
      reader.addEventListener('load', () => setImgSrc(reader.result.toString() || ''));
      reader.readAsDataURL(e.target.files[0]);
      setOriginalFile(e.target.files[0]);
    }
  };

  const onImageLoad = (e) => {
    imgRef.current = e.currentTarget;
    const { width, height } = e.currentTarget;
    // Centrar el crop por defecto
    const newCrop = centerCrop(
      makeAspectCrop({ unit: '%', width: 90 }, 16 / 9, width, height),
      width,
      height
    );
    setCrop(newCrop);
    setCompletedCrop(newCrop);
  };

  const handleCrop = async () => {
    if (completedCrop?.width && completedCrop?.height && imgRef.current) {
      const croppedImageBase64 = await getCroppedImg(
        imgRef.current,
        completedCrop,
        originalFile.name
      );
      onCropComplete({
        imageBase64: croppedImageBase64,
        originalFilename: originalFile.name,
      });
      // Resetear estado
      setImgSrc('');
      setOriginalFile(null);
      setCrop(undefined);
      setCompletedCrop(undefined);
      fileInputRef.current.value = null;
    }
  };

  return (
    <div className="relative w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:bg-gray-50 transition-colors">
      {!imgSrc && (
        <div className="flex flex-col items-center justify-center h-48">
          <UploadCloud className="w-12 h-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">
            Arrastra un archivo o haz clic para seleccionar
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/webp"
            onChange={onSelectFile}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
      )}

      {imgSrc && (
        <div className="flex flex-col items-center gap-4">
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={null} // Aspecto libre
          >
            <img
              ref={imgRef}
              alt="Crop me"
              src={imgSrc}
              onLoad={onImageLoad}
              style={{ maxHeight: '70vh' }}
            />
          </ReactCrop>
          <div className="flex gap-4">
            <Button onClick={handleCrop} disabled={!completedCrop}>
              <Check className="w-4 h-4 mr-2" />
              Confirmar y Procesar
            </Button>
            <Button variant="outline" onClick={() => setImgSrc('')}>
              <Scissors className="w-4 h-4 mr-2" />
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
