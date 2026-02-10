import { FontDropzone } from './components/FontDropzone';
import { Toaster } from 'sonner';

function App() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            typeBrew
          </h1>
          <p className="text-muted-foreground">
            Manage your font collection with ease
          </p>
        </header>

        <FontDropzone />
      </div>
      <Toaster />
    </div>
  );
}

export default App;
