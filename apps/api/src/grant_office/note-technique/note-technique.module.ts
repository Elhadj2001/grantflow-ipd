import { Module } from '@nestjs/common';
import { NoteTechniqueController } from './note-technique.controller';
import { NoteTechniqueService } from './note-technique.service';

@Module({
  controllers: [NoteTechniqueController],
  providers: [NoteTechniqueService],
  exports: [NoteTechniqueService],
})
export class NoteTechniqueModule {}
